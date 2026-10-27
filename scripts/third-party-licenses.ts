import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface LicensedPackage {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
}

const RULE = '='.repeat(72);

/**
 * The license texts of every production dependency, for
 * THIRD_PARTY_LICENSES.txt in the built extension: the bundle carries their
 * code, and their licenses ask for the notices to travel with it.
 */
export function thirdPartyLicenses(): string {
  const byLicense = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' })) as Record<
    string,
    LicensedPackage[]
  >;
  const entries = Object.values(byLicense)
    .flat()
    .flatMap((pkg) => pkg.paths.map((dir, i) => ({ ...pkg, version: pkg.versions[i] ?? '', dir })))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const sections = entries.map(({ name, version, license, homepage, dir }) => {
    const files = readdirSync(dir).filter((file) => /^(licen[cs]e|copying|notice)/i.test(file)).sort();
    const texts = files.map((file) => readFileSync(path.join(dir, file), 'utf8').trim());
    const header = [`${name} ${version} (${license})`, homepage].filter(Boolean).join('\n');
    return `${RULE}\n${header}\n${RULE}\n\n${texts.length ? texts.join('\n\n') : `Licensed under ${license}; the package ships no license file.`}\n`;
  });
  return `Browser Helper Lite includes the following third-party software.\n\n${sections.join('\n')}`;
}
