import { createWriteStream } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

class TapWriter {
  #stream;
  #testCount = 0;

  constructor(stream) {
    this.#stream = stream;
  }

  version() {
    this.#stream.write(`TAP version 14\n`);
  }

  testPoint(ok, description, directive, data) {
    this.#stream.write(`${ok ? 'ok' : 'not ok'} ${++this.#testCount} - ${description}`);
    if (directive) {
      this.#stream.write(` # ${directive}`);
    }
    this.#stream.write('\n');
    if (data) {
      this.#stream.write('  ---\n');
      for (const line of YAML.stringify(data).split('\n')) {
        this.#stream.write(`  ${line}\n`);
      }
      this.#stream.write('  ...\n');
    }
  }

  plan() {
    this.#stream.write(`1..${this.#testCount}\n`);
  }
}

function formatErrorMessage(error) {
  // remove escape codes that jest is leaving in the error message
  return error?.replaceAll(/\x1b\[\d+\w/g, '');
}

export default class TapReporter {
  constructor(globalConfig, reporterOptions, reporterContext) {
    this._globalConfig = globalConfig;
    this._options = reporterOptions;
    this._context = reporterContext;
  }

  onRunComplete(_testContexts, results) {
    let stream = this._options.filePath
      ? createWriteStream(this._options.filePath)
      : process.stdout;
    let writer = new TapWriter(stream);
    writer.version();

    for (const suiteResult of results.testResults) {
      if (suiteResult.testExecError) {
        // suite failed altogether, treat this as a failed single test
        writer.testPoint(
          false,
          suiteResult.displayName ?? this.#relativePath(suiteResult.testFilePath),
          undefined,
          {
            code: suiteResult.testExecError.code,
            message: suiteResult.testExecError.message,
            stack: suiteResult.testExecError.stack,
            type: suiteResult.testExecError.type,
          },
        );
      } else {
        // suite passed, now iterate over individual tests
        for (const testResult of suiteResult.testResults) {
          switch (testResult.status) {
            case 'passed':
              writer.testPoint(true, testResult.fullName, undefined, undefined);
              break;
            case 'failed':
              writer.testPoint(false, testResult.fullName, undefined, {
                message: formatErrorMessage(testResult.failureMessages[0]) ?? 'Unknown failure',
                more: testResult.failureMessages.slice(1).map(formatErrorMessage),
              });
              break;
            case 'skipped':
            case 'pending':
              writer.testPoint(true, testResult.fullName, 'skip', undefined);
              break;
            case 'todo':
              writer.testPoint(false, testResult.fullName, 'todo', undefined);
              break;
            default:
              writer.testPoint(false, testResult.fullName, undefined, {
                message: `Unknown status ${testResult.status}`,
              });
              break;
          }
        }
      }
    }

    writer.plan();

    if (stream !== process.stdout) {
      stream.end();
    }
  }

  getLastError() {
    return undefined;
  }

  #relativePath(file) {
    return path.relative(this._globalConfig.rootDir, file);
  }
}
