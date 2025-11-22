"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAnalyticsOnReceiptCreate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const app_1 = require("firebase-admin/app");
const firestore_2 = require("firebase-admin/firestore");
(0, app_1.initializeApp)();
const db = (0, firestore_2.getFirestore)();
exports.updateAnalyticsOnReceiptCreate = (0, firestore_1.onDocumentCreated)({
    region: "africa-south1",
    document: "receipts/{receiptId}",
    maxInstances: 10,
}, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const receipt = snap.data();
    const vendorId = receipt.vendorId;
    const items = receipt.items || [];
    const totalAmount = receipt.totalAmount || 0;
    const analyticsRef = db.collection("analytics").doc(vendorId);
    const analyticsSnap = await analyticsRef.get();
    // Create analytics if missing
    if (!analyticsSnap.exists) {
        await analyticsRef.set({
            totalRevenue: totalAmount,
            totalSold: 0,
            totalAvailable: 0,
            dailySales: {},
            topItems: [],
            aiSuggestion: "",
            lastUpdated: firestore_2.FieldValue.serverTimestamp(),
        });
    }
    // 🔹 Reload analytics after creating it to ensure fields exist
    const updatedSnap = await analyticsRef.get();
    const analytics = updatedSnap.data() || {};
    // ----------------------------
    // 1. Update product stock
    // ----------------------------
    let soldCount = 0;
    for (const item of items) {
        // FIX: items DO NOT have productId, so use item.item
        const productRef = db
            .collection("vendors")
            .doc(vendorId)
            .collection("products")
            .doc(item.item); // Using item.item instead of item.productId
        const productSnap = await productRef.get();
        if (productSnap.exists) {
            const p = productSnap.data();
            const newStock = (p.stock || 0) - item.quantity;
            const newSold = (p.sold || 0) + item.quantity;
            await productRef.update({
                stock: Math.max(newStock, 0),
                sold: newSold,
                updatedAt: firestore_2.FieldValue.serverTimestamp(),
            });
            soldCount += item.quantity;
        }
    }
    // ----------------------------
    // 2. Update analytics
    // ----------------------------
    const dayKey = new Date().toISOString().split("T")[0];
    const dailySales = analytics.dailySales || {};
    dailySales[dayKey] = (dailySales[dayKey] || 0) + totalAmount;
    const topItems = analytics.topItems || [];
    // FIX: items use "item" not "name"
    items.forEach((item) => {
        const existing = topItems.find((t) => t.name === item.item);
        if (existing)
            existing.count += item.quantity;
        else
            topItems.push({ name: item.item, count: item.quantity });
    });
    const totalSold = (analytics.totalSold || 0) + soldCount;
    // Recalculate totalAvailable from product collection
    const productsSnap = await db
        .collection("vendors")
        .doc(vendorId)
        .collection("products")
        .get();
    const totalAvailable = productsSnap.docs.reduce((sum, d) => sum + (d.data().stock || 0), 0);
    const bestItem = [...topItems].sort((a, b) => b.count - a.count)[0];
    const aiSuggestion = bestItem
        ? `Great job! ${bestItem.name} is selling quickly. You may need to restock soon.`
        : "Sales look stable today.";
    await analyticsRef.update({
        totalRevenue: (analytics.totalRevenue || 0) + totalAmount,
        totalSold,
        totalAvailable,
        dailySales,
        topItems,
        aiSuggestion,
        lastUpdated: firestore_2.FieldValue.serverTimestamp(),
    });
    console.log(`Analytics + Stock updated for vendor ${vendorId}`);
});
// import { onDocumentCreated } from "firebase-functions/v2/firestore";
// import { initializeApp } from "firebase-admin/app";
// import { getFirestore, FieldValue } from "firebase-admin/firestore";
// initializeApp();
// const db = getFirestore();
// export const updateAnalyticsOnReceiptCreate = onDocumentCreated(
//   {
//     region: "africa-south1",
//     document: "receipts/{receiptId}",
//     maxInstances: 10,
//   },
//   async (event) => {
//     const snap = event.data;
//     if (!snap) return;
//     const receipt = snap.data();
//     const vendorId = receipt.vendorId;
//     const items = receipt.items || [];
//     const totalAmount = receipt.totalAmount || 0;
//     const analyticsRef = db.collection("analytics").doc(vendorId);
//     const analyticsSnap = await analyticsRef.get();
//     // Create analytics if missing
//     if (!analyticsSnap.exists) {
//       await analyticsRef.set({
//         totalRevenue: totalAmount,
//         totalSold: 0,
//         totalAvailable: 0,
//         dailySales: {},
//         topItems: [],
//         aiSuggestion: "",
//         lastUpdated: FieldValue.serverTimestamp(),
//       });
//     }
//     const analytics = analyticsSnap.data() || {};
//     // ----------------------------
//     // 1. Update product stock
//     // ----------------------------
//     let soldCount = 0;
//     for (const item of items) {
//       // FIX: your items DO NOT have productId, so use item name instead
//       const productRef = db
//         .collection("vendors")
//         .doc(vendorId)
//         .collection("products")
//         .doc(item.item); // <-- FIXED: using item.item
//       const productSnap = await productRef.get();
//       if (productSnap.exists) {
//         const p = productSnap.data()!;
//         const newStock = (p.stock || 0) - item.quantity;
//         const newSold = (p.sold || 0) + item.quantity;
//         await productRef.update({
//           stock: Math.max(newStock, 0),
//           sold: newSold,
//           updatedAt: FieldValue.serverTimestamp(),
//         });
//         soldCount += item.quantity;
//       }
//     }
//     // ----------------------------
//     // 2. Update analytics
//     // ----------------------------
//     const dayKey = new Date().toISOString().split("T")[0];
//     const dailySales = analytics.dailySales || {};
//     dailySales[dayKey] = (dailySales[dayKey] || 0) + totalAmount;
//     const topItems = analytics.topItems || [];
//     // FIX: your items use "item" not "name"
//     items.forEach((item: any) => {
//       const existing = topItems.find((t: any) => t.name === item.item);
//       if (existing) existing.count += item.quantity;
//       else topItems.push({ name: item.item, count: item.quantity });
//     });
//     const totalSold = (analytics.totalSold || 0) + soldCount;
//     // Recalculate totalAvailable from product collection
//     const productsSnap = await db
//       .collection("vendors")
//       .doc(vendorId)
//       .collection("products")
//       .get();
//     const totalAvailable = productsSnap.docs.reduce(
//       (sum, d) => sum + (d.data().stock || 0),
//       0
//     );
//     const bestItem = [...topItems].sort((a, b) => b.count - a.count)[0];
//     const aiSuggestion = bestItem
//       ? `Great job! ${bestItem.name} is selling quickly. You may need to restock soon.`
//       : "Sales look stable today.";
//     await analyticsRef.update({
//       totalRevenue: (analytics.totalRevenue || 0) + totalAmount,
//       totalSold,
//       totalAvailable,
//       dailySales,
//       topItems,
//       aiSuggestion,
//       lastUpdated: FieldValue.serverTimestamp(),
//     });
//     console.log(`Analytics + Stock updated for vendor ${vendorId}`);
//   }
// );
