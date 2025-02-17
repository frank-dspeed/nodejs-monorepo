import * as path from 'path';
import * as fs from 'fs';
import { FancyMap } from '@straw-hat/fancy-map';
import { createDebugger } from './debug';
import resolve from 'resolve';
import { ContextDir, Environments, TsConfig } from './types';
import makeDir from 'make-dir';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const debug = createDebugger('helpers');
const cache = new FancyMap<string, any>();

export function setNodeEnv(env: Environments) {
  process.env.NODE_ENV = env;
  debug(`Current NODE_ENV: ${env}`);
}

export function isCI() {
  return !!process.env.CI;
}

export function getCwd() {
  return fs.realpathSync(process.cwd());
}

export function getShcConfig(context: ContextDir) {
  return cache.getOrSet('SHC_CONFIG', () => loadConfig(context));
}

export function getTsConfig(context: ContextDir): TsConfig {
  const filePath = path.join(context, 'tsconfig.json');
  const hasTsConfig = fs.existsSync(filePath);

  const defaultConfig = { compilerOptions: {} };

  if (!hasTsConfig) {
    return defaultConfig;
  }

  const ts = require(resolve.sync('typescript', {
    basedir: path.join(context, 'node_modules'),
  }));

  return ts.readConfigFile(filePath, ts.sys.readFile).config;
}

function loadConfig(context: ContextDir) {
  const filePath = path.resolve(context, 'shc.config.js');

  if (!fs.existsSync(filePath)) {
    return {};
  }

  debug(`Configuration file found. Loading ${filePath}`);

  try {
    return require(filePath);
  } catch (e: any) {
    throw new Error(`Failed to load SHC configuration file ${filePath}.\n${e.message}`);
  }
}

export function touchFileSync(filePath: string) {
  try {
    const stats = fs.statSync(filePath);
    if (stats && stats.isFile()) return filePath;
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }

    makeDir.sync(path.dirname(filePath));
  }

  fs.writeFileSync(filePath, '');

  return filePath;
}

export function loadDotEnv(env: Environments, context: ContextDir) {
  const dotenvPath = path.resolve(context, '.env');

  const dotenvFiles = [
    `${dotenvPath}.${env}.local`,
    `${dotenvPath}.${env}`,
    env !== 'test' && `${dotenvPath}.local`,
    dotenvPath,
  ].filter(Boolean) as string[];

  dotenvFiles.filter(fs.existsSync).forEach((filePath: string) => {
    debug(`Loading environment variable's file: ${filePath}`);
    dotenvExpand(dotenv.config({ path: filePath }));
  });
}
