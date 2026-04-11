export type TencentSkillHubInstallStatus = 'not_installed' | 'installed' | 'updatable';

export interface TencentSkillHubVersion {
  version: string;
  publishedAt?: string;
}

export interface TencentSkillHubCatalogItem {
  slug: string;
  name: string;
  description: string;
  latestVersion: string;
  homepage?: string;
  iconUrl?: string;
  packageUrl?: string;
  downloadCandidates?: string[];
}

export interface TencentSkillHubCatalogEntry extends TencentSkillHubCatalogItem {
  installStatus: TencentSkillHubInstallStatus;
  installedVersion?: string;
}

export interface TencentSkillHubCatalogResponse {
  success: boolean;
  skills: TencentSkillHubCatalogEntry[];
  total: number;
  error?: string;
}

export interface TencentSkillHubSkillDetail extends TencentSkillHubCatalogItem {
  versions?: TencentSkillHubVersion[];
  latestVersionInfo?: TencentSkillHubVersion;
  packageUrl?: string;
}

export interface TencentSkillHubPackage {
  files: Record<string, string>;
}

export interface TencentSkillHubInstallOrigin {
  version: 1;
  registry: string;
  slug: string;
  installedVersion: string;
  installedAt: number;
}

export interface TencentSkillHubLockfile {
  version: 1;
  skills: Record<
    string,
    {
      version: string;
      installedAt: number;
    }
  >;
}

export interface TencentSkillHubInstallResult {
  success: boolean;
  slug: string;
  version?: string;
  targetDir?: string;
  error?: string;
}
