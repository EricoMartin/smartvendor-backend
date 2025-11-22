// import express from "express";
import express, { Request, Response } from "express";
import { Firestore } from "@google-cloud/firestore";
import vision from "@google-cloud/vision";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();
const db = new Firestore();
const visionClient = new vision.ImageAnnotatorClient();
const client = new GoogleGenAI({
  // apiKey: process.env.GOOGLE_API_KEY, // or use service account credentials
  location: "global",
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
});

// Simple structured logger used throughout this file. Controlled by DEBUG env var.
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV !== "production";
function log(level: 'info' | 'warn' | 'error' | 'debug', ...args: any[]) {
  const ts = new Date().toISOString();
  if (level === 'debug' && !DEBUG) return;
  const out = [ts, level.toUpperCase(), ...args];
  if (level === 'error') console.error(...out);
  else if (level === 'warn') console.warn(...out);
  else console.log(...out);
}

// Mock mode toggles for local/hackathon testing (no external API calls)
const MOCK_OCR = process.env.MOCK_OCR === "true";
const MOCK_AI = process.env.MOCK_AI === "true";

export const parseReceiptEndpoint = async (req: Request, res: Response) => {
  try {
    const { imageUrl, vendorId, date } = req.body;

    log('info', 'parseReceiptEndpoint called', { imageUrl: imageUrl ? '[REDACTED]' : imageUrl, vendorId, date });

    if (!imageUrl || !vendorId) {
      return res.status(400).json({ error: "imageUrl and vendorId are required" });
    }

    // 1️⃣ OCR (or mock)
    let rawText: string | undefined;
    if (MOCK_OCR) {
      log('info', 'MOCK_OCR enabled — using canned OCR text');
      rawText = `STORE X\n1x Bread 500\n2x Milk 800\nTOTAL 2100`;
      log('debug', `Mock OCR text length=${rawText.length}`);
    } else {
      // Use an explicit request object for clarity (works for image URIs and GCS URIs)
      log('debug', 'Calling Vision documentTextDetection');
      const [ocrResult] = await visionClient.documentTextDetection({ image: { source: { imageUri: imageUrl } } } as any);
      rawText = ocrResult?.fullTextAnnotation?.text?.trim();
      if (!rawText) {
        log('warn', 'OCR returned no text', { ocrResult });
        return res.status(500).json({ error: "No text found in the image via OCR" });
      }
      log('info', `OCR extracted text length=${rawText.length}`);
    }

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
    // 2️⃣ Parse using Gemini (or mock)
    let parsedJson: any = null;
    if (MOCK_AI) {
      log('info', 'MOCK_AI enabled — returning canned parsed JSON');
      parsedJson = {
        totalAmount: 2100,
        items: [
          { item: 'Bread', quantity: 1, price: 500 },
          { item: 'Milk', quantity: 2, price: 800 }
        ]
      };
    } else {
      parsedJson = await Promise.race([
        parseWithGemini(prompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), timeoutMs))
      ]).catch((e) => {
        log('error', 'Error or timeout while parsing with Gemini', e);
        return null;
      });
    }

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
    } catch (e) {
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

  } catch (err: any) {
    console.error("Error parsing receipt:", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
};

async function parseWithGemini(prompt: string) {
  try {
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash-001",
      contents: prompt,
    });

    const candidate: any = (response as any)?.candidates?.[0] ?? (response as any)?.candidate ?? null;
    if (!candidate) {
      log('error', 'Gemini: No candidates returned', { response });
      return null;
    }

    // helper to join parts or arrays into a single string
    const joinParts = (p: any) => {
      try {
        if (typeof p === 'string') return p;
        if (Array.isArray(p)) return p.map((x) => (typeof x === 'string' ? x : (x?.text ?? x?.content ?? JSON.stringify(x)))).join('');
        if (typeof p === 'object') {
          // If parts are objects with .text or .content
          if (Array.isArray(p.parts)) return p.parts.map((x: any) => (typeof x === 'string' ? x : x?.text ?? x?.content ?? JSON.stringify(x))).join('');
          return p.text ?? p.content ?? JSON.stringify(p);
        }
        return String(p);
      } catch (e) {
        return String(p);
      }
    };

    // Try multiple common locations for generated text
    let outputText: string | null = null;
    const attempts: any[] = [];

    // candidate could be a raw string
    attempts.push(candidate);
    // candidate.content (string or object with parts)
    attempts.push(candidate.content);
    // candidate.content.parts
    attempts.push(candidate.content?.parts);
    // candidate.output or candidate.output[0].content
    attempts.push(candidate.output);
    attempts.push(candidate.output?.[0]?.content);
    // candidate.message?.content
    attempts.push(candidate.message?.content);

    for (const a of attempts) {
      if (!a && a !== '') continue;
      const joined = joinParts(a);
      if (joined && joined.trim().length > 0) {
        outputText = joined;
        break;
      }
    }

    if (!outputText) {
      log('error', 'Gemini: could not extract text from candidate', { candidate });
      return null;
    }

    // Clean code fences and surrounding text
    const cleaned = outputText.replace(/```json/g, '').replace(/```/g, '').trim();
    log('debug', 'Gemini raw output snippet', cleaned.slice(0, 800));

    // Try direct JSON.parse first
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      log('warn', 'JSON.parse failed on full output; attempting to extract JSON substring', { err: String(err) });
      // Attempt to extract the first {...} substring and parse that
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidateJson = cleaned.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(candidateJson);
        } catch (err2) {
          log('error', 'Failed to parse extracted JSON substring', { err2: String(err2), candidateJsonSnippet: candidateJson.slice(0, 800) });
          return null;
        }
      }
      return null;
    }

  } catch (err) {
    log('error', 'Gemini error', err);
    return null;
  }

}