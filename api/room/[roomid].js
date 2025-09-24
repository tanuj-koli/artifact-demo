import { Redis } from "@upstash/redis";

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    const { roomid } = req.query;

    if (!roomid) return res.status(400).json({ error: "Missing room ID" });

    if (req.method === "GET") {
        const update = await redis.get(roomid); // stored as array of numbers
        if (update) {
        return res.status(200).json({ update });
        } else {
        return res.status(200).json({ update: null });
        }
    }

    if (req.method === "POST") {
        const { update } = req.body;
        if (!update) return res.status(400).json({ error: "Missing update data" });

        // Save the Yjs update as array of numbers
        await redis.set(roomid, Array.from(update));
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
}
