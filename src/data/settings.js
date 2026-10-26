/**
 * Rules for the rider's settings: valid ranges and how an FTP result is applied.
 * Pure functions; the repository stores what these produce.
 */

/** Accepted FTP range in watts. */
export const FTP_RANGE = [50, 600];
/** Accepted heart-rate ranges in bpm, per setting. */
export const HR_RANGE = { lthr: [100, 220], maxHr: [120, 230] };

const inRange = (value, [min, max]) => value >= min && value <= max;

/**
 * Check a settings patch before it is applied.
 * @param {object} patch  partial settings, e.g. {ftp: 250} or {lthr: null}
 * @returns {{ok:true} | {ok:false, error:string}}  the error is shown to the rider
 */
export function validateSettingsPatch(patch) {
  if ('ftp' in patch && !inRange(patch.ftp, FTP_RANGE)) {
    return { ok: false, error: `Enter an FTP between ${FTP_RANGE[0]} and ${FTP_RANGE[1]} W` };
  }
  for (const [key, range] of Object.entries(HR_RANGE)) {
    if (patch[key] != null && !inRange(patch[key], range)) {
      return { ok: false, error: `Enter a heart rate between ${range[0]} and ${range[1]} bpm, or leave it empty` };
    }
  }
  return { ok: true };
}

/**
 * Settings after applying an FTP result: the patch, plus a history entry
 * recording when the FTP was set and by which method.
 * @param {object} settings
 * @param {{ftp:number, lthr?:number, maxHr?:number}} patch  from ui/ftp-result.js settingsPatch()
 * @param {string} method  the protocol id, e.g. 'ramp'
 * @param {number} date  Date.now()
 */
export function withFtpResult(settings, patch, method, date) {
  return { ...settings, ...patch, ftpHistory: [...(settings.ftpHistory ?? []), { date, ftp: patch.ftp, method }] };
}
