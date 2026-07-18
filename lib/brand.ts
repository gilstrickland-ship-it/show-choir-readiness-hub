// Constitution IX — Name-Agnostic Codebase.
// This is the single source of all branding. No product name may be hardcoded
// anywhere else in the codebase; every UI string, PDF footer, email from-name,
// and metadata value reads from here. Renaming is a one-file change plus DNS.
//
// The default values below are the ONLY place the working codename may appear.

export interface Brand {
  name: string;
  domain: string;
  supportEmail: string;
  emailFromName: string;
}

export const brand: Brand = {
  name: process.env.BRAND_NAME ?? "Octv",
  domain: process.env.BRAND_DOMAIN ?? "octv.example",
  supportEmail: process.env.BRAND_SUPPORT_EMAIL ?? "support@octv.example",
  emailFromName: process.env.BRAND_EMAIL_FROM_NAME ?? "Octv",
};
