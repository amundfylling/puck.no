/**
 * Single source of truth for federation-wide site configuration.
 */

/**
 * Confirmed content-owner decision: The federation has organised table hockey
 * tournaments since 1991.
 */
export const ORGANIZED_SINCE_YEAR = 1991;

export const SITE_CONFIG = {
  name: 'Norges Bordhockeyforbund',
  nameEn: 'Norwegian Table Hockey Association',
  shortName: 'NBHF',
  canonicalOrigin: 'https://www.puck.no',
  contactEmail: 'amund.fylling@puck.no',
  organizedSince: ORGANIZED_SINCE_YEAR,
} as const;
