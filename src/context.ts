import { $ } from "bun";
import { resolve } from "path";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;
  failed: boolean;
}

export interface RunOptions {
  echo?: boolean;
  warn?: boolean;
  hide?: boolean;
  cwd?: string;
}

export class Context {
  cwd: string;
  private options: RunOptions;

  constructor(options: RunOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.options = options;
  }

  get pwd(): string {
    return this.cwd;
  }

  get config(): RunOptions {
    return { ...this.options };
  }

  // Alias for run() - explicit local execution
  local = this.run.bind(this);

  async run(command: string, options?: RunOptions): Promise<RunResult> {
    const opts = { ...this.options, ...options };

    if (opts.echo) {
      console.log(`$ ${command}`);
    }

    const result = await $`sh -c ${command}`
      .cwd(opts.cwd ?? this.cwd)
      .nothrow()
      .quiet();

    const runResult: RunResult = {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      code: result.exitCode,
      ok: result.exitCode === 0,
      failed: result.exitCode !== 0,
    };

    if (!opts.warn && runResult.failed) {
      const error = new Error(
        `Command failed with exit code ${runResult.code}: ${command}`,
      );
      (error as any).result = runResult;
      throw error;
    }

    if (!opts.hide) {
      if (runResult.stdout) process.stdout.write(runResult.stdout);
      if (runResult.stderr) process.stderr.write(runResult.stderr);
    }

    return runResult;
  }

  async sudo(command: string, options?: RunOptions): Promise<RunResult> {
    return this.run(`sudo ${command}`, options);
  }

  async *cd(directory: string): AsyncGenerator<void, void, unknown> {
    const previous = this.cwd;
    this.cwd = resolve(this.cwd, directory);
    try {
      yield;
    } finally {
      this.cwd = previous;
    }
  }
}
