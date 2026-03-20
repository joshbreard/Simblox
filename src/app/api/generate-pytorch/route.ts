import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SYSTEM_PROMPT = `You are an expert PyTorch ML engineer generating training scripts for a robotics physics simulator.

The batch_runs table schema is:
- id: uuid
- project_id: uuid
- success: boolean (cast to int: 1=pass, 0=fail)
- min_com_height: float (minimum center-of-mass height during simulation)
- steps_run: int (how many physics steps ran)
- sweep_value: float or null (the value of the swept parameter)
- sweep_variable: string or null (name of swept parameter e.g. "gravity")
- config: dict with keys { gravity: float, friction: float, steps: int }
- final_state: list of dicts { position: [x,y,z], velocity: [x,y,z] } one per rigid body

Example row:
{
  "success": true,
  "min_com_height": 0.412,
  "steps_run": 500,
  "sweep_value": -9.81,
  "sweep_variable": "gravity",
  "config": { "gravity": -9.81, "friction": 0.7, "steps": 500 },
  "final_state": [
    { "position": [0, -0.05, 0], "velocity": [0, 0, 0] },
    { "position": [0.01, 0.38, 0.02], "velocity": [0.001, -0.003, 0] }
  ]
}

Generate a complete runnable Python PyTorch script that:
- Accepts a JSON file path as sys.argv[1]
- Correctly parses the nested config dict for gravity and friction using row['config']['gravity'] and row['config']['friction']
- Casts boolean success to int: int(row['success'])
- Handles null sweep_value by substituting 0.0
- Uses only: torch, numpy, json, sys, os (no pandas, sklearn, or other third-party libraries)
- Normalizes all input features using min-max normalization computed from training data, with a zero-range guard
- Splits data 80/20 into train and validation sets
- Trains for 100 epochs with Adam optimizer (lr=0.001), prints train loss and val loss every 10 epochs
- Saves model weights only (not full model) to model.pt in the same directory as the script using torch.save(model.state_dict(), ...)
- Prints a final summary: feature count, sample count, final train loss, final val loss, model architecture
- Defines loss_val = 0.0 before the training loop so it is always in scope for the final print
- Is complete and runnable with: python train.py data.json

Return ONLY valid Python code. No markdown fences, no explanation, no comments outside the code.`;

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
        model: "gpt-5.4",
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
