import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SYSTEM_PROMPT = `You are an expert PyTorch ML engineer. The user will describe what ML model they want to build for a robotics physics simulation dataset. You will be given the database schema of available training data.

Generate a complete, runnable Python PyTorch script that:
- Accepts a JSON file path as sys.argv[1] (array of batch_run rows from Supabase)
- Parses the JSON and extracts appropriate features and labels based on the user's description
- Defines a PyTorch model class appropriate to the task (MLP, LSTM, or other if justified)
- Trains the model for 100 epochs with Adam optimizer, prints loss every 10 epochs
- Saves the trained model to model.pt using torch.save in the same directory as the script
- Is complete and runnable with: python train.py data.json

Rules:
- Only use: torch, numpy, json, sys, os (no pandas, sklearn, etc.)
- Handle missing/null values by replacing with 0.0
- Normalize input features using min-max normalization computed from the training data
- Print a final summary: feature count, sample count, final loss, model architecture
- Return ONLY the Python code, no markdown, no explanation`;

export async function POST(req: Request) {
  try {
    const { description, project_id, model_id, batch_schema_summary } =
      (await req.json()) as {
        description?: string;
        project_id?: string;
        model_id?: string;
        batch_schema_summary?: string;
      };

    if (!description || !project_id || !model_id || !batch_schema_summary) {
      return NextResponse.json(
        { error: "description, project_id, model_id, and batch_schema_summary are required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured on server" },
        { status: 500 }
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
          {
            role: "user",
            content: `Dataset schema:\n${batch_schema_summary}\n\nUser's model description:\n${description}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `OpenAI API error: ${res.status} ${body}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";

    // Strip markdown fences if present
    const script = raw
      .replace(/```python\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    // Save to Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      const sb = createClient(supabaseUrl, serviceKey);
      await sb
        .from("project_models")
        .update({ pytorch_script: script })
        .eq("id", model_id);
    }

    return NextResponse.json({ script });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
