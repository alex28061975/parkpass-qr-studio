import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config({ override: true });

const _dirname = typeof __dirname !== "undefined" ? __dirname : process.cwd();

// In-memory store for generated permit images to allow public access via Twilio or sharing links
const permitCache = new Map<string, { base64: string; name: string; createdAt: number }>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 images and large spreadsheets
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API Route: Upload permit base64 image
  app.post("/api/permits/upload", (req, res) => {
    try {
      const { base64, name } = req.body;
      if (!base64) {
        return res.status(400).json({ error: "Missing base64 image data" });
      }

      // Generate a unique ID for the permit
      const id = "pmt_" + Math.random().toString(36).substring(2, 15);
      
      // Store in memory
      permitCache.set(id, {
        base64,
        name: name || "permit",
        createdAt: Date.now()
      });

      // Automatically clean up old images after 24 hours to prevent memory leaks
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      for (const [key, val] of permitCache.entries()) {
        if (Date.now() - val.createdAt > TWENTY_FOUR_HOURS) {
          permitCache.delete(key);
        }
      }

      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.get("host");
      const imageUrl = `${protocol}://${host}/api/permit-image/${id}.png`;
      const viewUrl = `${protocol}://${host}/permit/${id}`;

      res.json({ id, imageUrl, viewUrl });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Serve the public permit PNG image directly
  app.get("/api/permit-image/:id.png", (req, res) => {
    const { id } = req.params;
    const permit = permitCache.get(id);

    if (!permit) {
      return res.status(404).send("Permit image not found or expired.");
    }

    try {
      // Decode the base64 back to binary data
      const cleanBase64 = permit.base64.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(cleanBase64, "base64");

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `inline; filename="${permit.name}.png"`);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(imageBuffer);
    } catch (error) {
      console.error("Error serving image:", error);
      res.status(500).send("Error rendering image.");
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Serve client config (e.g. Supabase credentials)
  app.get("/api/config", (req, res) => {
    const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    const rawKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

    const defaultUrl = "https://ihhkitfpjmhudyzdhlpg.supabase.co";
    const defaultKey = "sb_publishable_-7OtzoSb8zYjAXHR_Gk6dg_jAqiUyHQ";

    const supabaseUrl = rawUrl.startsWith("http") ? rawUrl : (rawKey.startsWith("http") ? rawKey : defaultUrl);
    const supabaseAnonKey = !rawKey.startsWith("http") && rawKey.length > 0 ? rawKey : (!rawUrl.startsWith("http") && rawUrl.length > 0 ? rawUrl : defaultKey);

    res.json({
      supabaseUrl,
      supabaseAnonKey
    });
  });

  // Vite integration middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
