#!/usr/bin/env node
import { program } from 'commander';
import debug from 'debug';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import * as url from 'node:url';
import { webcrack } from './index.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const { version, description } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string; description: string };

debug.enable('webcrack:*');

interface Options {
  force: boolean;
  output?: string;
  mangle: boolean;
  jsx: boolean;
  unpack: boolean;
  deobfuscate: boolean;
  unminify: boolean;
}

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function listJsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsFiles(fullPath));
    } else if (entry.isFile() && extname(entry.name) === '.js') {
      files.push(fullPath);
    }
  }
  return files;
}

program
  .version(version)
  .description(description)
  .option('-o, --output <path>', 'output directory for bundled files')
  .option('-f, --force', 'overwrite output directory')
  .option('-m, --mangle', 'mangle variable names')
  .option('--no-jsx', 'do not decompile JSX')
  .option('--no-unpack', 'do not extract modules from the bundle')
  .option('--no-deobfuscate', 'do not deobfuscate the code')
  .option('--no-unminify', 'do not unminify the code')
  .argument('[file]', 'input file, defaults to stdin')
  .action(async (input: string | undefined) => {
    const { output, force, ...options } = program.opts<Options>();
    if (input) {
      const inputStat = await stat(input);
      if (inputStat.isDirectory()) {
        if (!output) {
          program.error('Output directory is required when processing a directory');
        }

        if (existsSync(output)) {
          if (force) {
            await rm(output, { recursive: true, force: true });
          } else {
            program.error('output directory already exists');
          }
        }

        const absInput = resolve(input);
        const absOutput = resolve(output);
        const files = await listJsFiles(absInput);
        for (const file of files) {
          try {
            const code = await readFile(file, 'utf8');
            const result = await webcrack(code, options);
            const relPath = relative(absInput, file);
            const outFile = join(absOutput, relPath);
            const outDir = dirname(outFile);
            await mkdir(outDir, { recursive: true });
            await writeFile(outFile, result.code, 'utf8');
            if (result.bundle) {
              await result.bundle.save(outDir);
            }
          } catch (err) {
            console.error(`Failed to process ${file}:`, err);
          }
        }
        return;
      }
    }

    const code = await (input ? readFile(input, 'utf8') : readStdin());
    if (output) {
      if (existsSync(output)) {
        if (force) {
          await rm(output, { recursive: true, force: true });
        } else {
          program.error('output directory already exists');
        }
      }
    }

    const result = await webcrack(code, options);
    if (output) {
      await result.save(output);
    } else {
      console.log(result.code);
      if (result.bundle) {
        debug('webcrack:unpack')(
          'Modules are not displayed in the terminal. Use the --output option to save them to a directory.',
        );
      }
    }
  })
  .parse();
