import express from "express";
import {Request, Response} from "express";
import { Firestore } from "@google-cloud/firestore";
import { updateAnalyticsOnReceiptCreate } from "./smartvendor-functions/analytics";
import { parseReceiptEndpoint } from "./app/parse_receipt";

const app = express();
app.use(express.json());

const db = new Firestore();

app.post("/parse-receipt", parseReceiptEndpoint);

app.post("/add-receipt", async (req: Request, res: Response) => {
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
  } catch (error: any) {
    res.status(500).send({ success: false, error: error.message });
  }
});

// app.post("/get-analytics/:vendorId", updateAnalyticsOnReceiptCreate);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`SmartVendor backend running on port ${PORT}`));
