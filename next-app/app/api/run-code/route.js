import { NextResponse } from "next/server";

// Wandbox — free, no API key required
const WANDBOX_URL = "https://wandbox.org/api/compile.json";

const COMPILER_MAP = {
  javascript: "nodejs-20.17.0",
  python:     "cpython-3.12.7",
  "c++":      "gcc-13.2.0",
  java:       "openjdk-jdk-22+36",
  go:         "go-1.22.8",
  rust:       "rust-1.81.0",
  typescript: "typescript-5.6.2",
  php:        "php-8.3.12",
};

export async function POST(req) {
  const { language, code } = await req.json();

  if (!language || !code) {
    return NextResponse.json({ error: "language and code are required" }, { status: 400 });
  }

  const compiler = COMPILER_MAP[language] || COMPILER_MAP["javascript"];

  try {
    const res = await fetch(WANDBOX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compiler, code, stdin: "" }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Execution error: ${text}` }, { status: res.status });
    }

    const data = await res.json();

    // Normalise to Piston-compatible shape so the client doesn't need changes
    const stdout   = data.program_output || data.program_message || "";
    const stderr   = (data.program_error || "") + (data.compiler_error ? `\nCompiler: ${data.compiler_error}` : "");
    const exitCode = parseInt(data.status || "0", 10);

    return NextResponse.json({
      run: {
        stdout,
        stderr: stderr.trim(),
        code: exitCode,
        output: stdout || stderr,
      },
      language,
      version: compiler,
    });
  } catch (err) {
    return NextResponse.json({ error: "Code execution failed: " + err.message }, { status: 500 });
  }
}
