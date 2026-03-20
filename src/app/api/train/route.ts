import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import { writeFile } from "fs/promises";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(req: Request) {
  try {
    const { model_id, pytorch_script, batch_rows } = (await req.json()) as {
      model_id?: string;
      pytorch_script?: string;
      batch_rows?: unknown[];
    };

    if (!model_id || !pytorch_script || !batch_rows) {
      return NextResponse.json(
        { error: "model_id, pytorch_script, and batch_rows are required" },
        { status: 400 }
      );
    }

    const scriptPath = `/tmp/train_${model_id}.py`;
    const dataPath = `/tmp/data_${model_id}.json`;

    await writeFile(scriptPath, pytorch_script, "utf-8");
    await writeFile(dataPath, JSON.stringify(batch_rows), "utf-8");

    const result = await new Promise<{ code: number; log: string }>(
      (resolve) => {
        const child = spawn("python3", [scriptPath, dataPath], {
          stdio: "pipe",
        });

        let output = "";

        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          output += "\n[ERROR] Training timed out after 5 minutes.";
          resolve({ code: 1, log: output });
        }, TIMEOUT_MS);

        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? 1, log: output });
        });
      }
    );

    if (result.code === 0) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        const sb = createClient(supabaseUrl, serviceKey);
        await sb
          .from("project_models")
          .update({ last_trained_at: new Date().toISOString() })
          .eq("id", model_id);
      }

      return NextResponse.json({ success: true, log: result.log });
    }

    return NextResponse.json(
      { success: false, log: result.log },
      { status: 500 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
