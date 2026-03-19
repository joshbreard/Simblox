import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a physics simulation criteria parser. The user will describe what a successful simulation looks like in plain English. Return a JSON object with numeric thresholds for any of these keys:

- base_drift_max: maximum allowed drift (meters) of the robot base from its initial position
- joint_separation_max: maximum allowed separation (meters) between connected joints
- min_avg_height: minimum average center-of-mass height (meters) the robot/object must maintain
- end_effector_reach_max: maximum allowed distance (meters) from the end effector to a target
- settle_time_max: maximum allowed time (seconds) for the system to reach a settled state
- nan_check: set to 1 if the user wants to detect NaN/divergence in the simulation, otherwise null

For any criterion you cannot confidently quantify from the input, set the value to null.

Return ONLY a valid JSON object with exactly these six keys, no extra text or markdown.`;

export async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured on server" },
        { status: 500 },
      );
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `OpenAI API error: ${res.status} ${body}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";

    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();

    const parsed = JSON.parse(cleaned);

    // Validate keys
    const KEYS = [
      "base_drift_max",
      "joint_separation_max",
      "min_avg_height",
      "end_effector_reach_max",
      "settle_time_max",
      "nan_check",
    ] as const;

    const result: Record<string, number | null> = {};
    for (const k of KEYS) {
      const v = parsed[k];
      result[k] = typeof v === "number" ? v : null;
    }

    return NextResponse.json({ criteria: result });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  }
}
