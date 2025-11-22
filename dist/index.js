"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const firestore_1 = require("@google-cloud/firestore");
const parse_receipt_1 = require("./app/parse_receipt");
const app = (0, express_1.default)();
app.use(express_1.default.json());
const db = new firestore_1.Firestore();
app.post("/parse-receipt", parse_receipt_1.parseReceiptEndpoint);
app.post("/add-receipt", async (req, res) => {
    try {
        const { vendorId, totalAmount, items, date } = req.body;
        const receiptRef = db.collection("receipts").doc();
        await receiptRef.set({
            vendorId,
            totalAmount,
            items,
            date: new Date(date),
            aiExtracted: false,
            createdAt: new Date(),
        });
        res.status(201).send({ success: true, id: receiptRef.id });
    }
    catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});
// app.post("/get-analytics/:vendorId", updateAnalyticsOnReceiptCreate);
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`SmartVendor backend running on port ${PORT}`));
