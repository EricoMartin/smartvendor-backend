"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReceiptEndpoint = void 0;
const firestore_1 = require("@google-cloud/firestore");
const vision_1 = __importDefault(require("@google-cloud/vision"));
const genai_1 = require("@google/genai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const db = new firestore_1.Firestore();
const visionClient = new vision_1.default.ImageAnnotatorClient();
const client = new genai_1.GoogleGenAI({
    // apiKey: process.env.GOOGLE_API_KEY, // or use service account credentials
    location: "global",
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
});
// Simple structured logger used throughout this file. Controlled by DEBUG env var.
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV !== "production";
function log(level, ...args) {
    const ts = new Date().toISOString();
    if (level === 'debug' && !DEBUG)
        return;
    const out = [ts, level.toUpperCase(), ...args];
    if (level === 'error')
        console.error(...out);
    else if (level === 'warn')
        console.warn(...out);
    else
        console.log(...out);
}
const parseReceiptEndpoint = async (req, res) => {
    try {
        const { imageUrl, vendorId, date } = req.body;
        log('info', 'parseReceiptEndpoint called', { imageUrl: imageUrl ? '[REDACTED]' : imageUrl, vendorId, date });
        if (!imageUrl || !vendorId) {
            return res.status(400).json({ error: "imageUrl and vendorId are required" });
        }
        // 1️⃣ OCR
        // Use an explicit request object for clarity (works for image URIs and GCS URIs)
        log('debug', 'Calling Vision documentTextDetection');
        const [ocrResult] = await visionClient.documentTextDetection({ image: { source: { imageUri: imageUrl } } });
        const rawText = ocrResult?.fullTextAnnotation?.text?.trim();
        if (!rawText) {
            log('warn', 'OCR returned no text', { ocrResult });
            return res.status(500).json({ error: "No text found in the image via OCR" });
        }
        log('info', `OCR extracted text length=${rawText.length}`);
        // 2️⃣ Parse using Gemini
        const prompt = `
You are a professional receipt parser. Convert the following receipt text
into structured JSON with fields:
- "item": string
- "quantity": integer
- "price": number in Naira (₦)
Include "totalAmount": number.
Include "Receipt ID": string.
Return ONLY valid JSON.

Receipt text:
${rawText}
`;
        const timeoutMs = parseInt(process.env.VERTEX_TIMEOUT_MS || "15000", 10);
        const parsedJson = await Promise.race([
            parseWithGemini(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), timeoutMs))
        ]).catch((e) => {
            log('error', 'Error or timeout while parsing with Gemini', e);
            return null;
        });
        if (!parsedJson || !Array.isArray(parsedJson.items)) {
            log('error', 'Parsed JSON missing items or invalid', { parsedJson });
            return res.status(500).json({ error: "Failed to parse receipt into structured data" });
        }
        // 3️⃣ Save to Firestore
        const receiptData = {
            vendorId,
            imageUrl,
            totalAmount: parsedJson.totalAmount || null,
            date: date ? new Date(date) : new Date(),
            items: parsedJson.items,
            aiExtracted: true,
            rawText,
            createdAt: new Date(),
        };
        let receiptRef;
        try {
            receiptRef = await db.collection("receipts").add(receiptData);
            log('info', 'Saved receipt to Firestore', { id: receiptRef.id });
        }
        catch (e) {
            log('error', 'Failed to save receipt to Firestore', e);
            return res.status(500).json({ error: 'Failed to save receipt' });
        }
        return res.status(201).json({
            status: "success",
            message: "Receipt parsed successfully",
            data: {
                id: receiptRef.id,
                vendorId: vendorId,
                parsed: parsedJson,
                rawTextPreview: rawText.slice(0, 200),
            },
        });
    }
    catch (err) {
        console.error("Error parsing receipt:", err);
        return res.status(500).json({ success: false, error: err.message || String(err) });
    }
};
exports.parseReceiptEndpoint = parseReceiptEndpoint;
async function parseWithGemini(prompt) {
    try {
        const response = await client.models.generateContent({
            model: "gemini-2.0-flash-001",
            contents: prompt,
        });
        const candidate = response.candidates?.[0];
        if (!candidate) {
            console.error("Gemini: No candidates returned");
            return null;
        }
        const parts = candidate.content?.parts;
        if (!parts || parts.length === 0 || !parts[0].text) {
            console.error("Gemini: No text returned in parts");
            return null;
        }
        const text = parts?.[0]?.text ?? "";
        if (!text) {
            console.error("Gemini returned empty text");
            return null;
        }
        const cleaned = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();
        console.log("CLEANED GEMINI OUTPUT:", cleaned);
        // Attempt JSON parsing
        try {
            return JSON.parse(cleaned);
        }
        catch (err) {
            console.error("Gemini returned NON-JSON text:\n", cleaned);
            return null;
        }
    }
    catch (err) {
        console.error("Gemini error:", err);
        return null;
    }
}
