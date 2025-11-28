import express from "express";
import cors from "cors";
import helmet from "helmet";
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false })); // Helmet CSP bəzən inline scriptləri bloklayır
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "dist");

// Static Files
app.use(express.static(distPath));

// API: NFT List
app.get("/api/nfts", async (req, res) => {
  const { data, error } = await supabase.from("metadata").select("*").order("tokenid", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ nfts: data });
});

// API: Create Order
app.post("/api/order", async (req, res) => {
  const { tokenid, price, seller_address, seaport_order, order_hash } = req.body;
  
  if (!tokenid || !seaport_order) return res.status(400).json({ error: "Missing data" });

  const { error } = await supabase.from("metadata").upsert({
    tokenid: tokenid.toString(),
    price: price,
    seaport_order: seaport_order,
    order_hash: order_hash,
    buyer_address: null, // Reset buyer
    on_chain: false,
    updatedat: new Date().toISOString()
  }, { onConflict: "tokenid" });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// API: Buy Complete
app.post("/api/buy", async (req, res) => {
  const { tokenid, buyer_address } = req.body;
  
  // Satış bitdi, listing məlumatlarını silirik və yeni sahibi yazırıq
  const { error } = await supabase.from("metadata").update({
    buyer_address: buyer_address.toLowerCase(),
    price: 0,
    seaport_order: null,
    order_hash: null,
    on_chain: true,
    updatedat: new Date().toISOString()
  }).eq("tokenid", tokenid.toString());

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// SPA Fallback (Bütün digər sorğuları index.html-ə yönləndirir)
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
