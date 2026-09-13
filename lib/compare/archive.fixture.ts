/**
 * Two real archives, base64, for the tests on either side of the boundary.
 *
 * Written by .NET's `ZipArchive` through PowerShell rather than by the library
 * that reads them here — a fixture produced by `@zip.js/zip.js` would prove the
 * two halves of one library agree with each other and nothing about whether
 * either agrees with the format.
 *
 * Both are stored uncompressed and are a couple of hundred bytes, so the sizes
 * the tests expect are also the real ones.
 */

/** `data/values.csv` (8 bytes) and `readme.txt` (5), with no directory records. */
export const PAIR_ARCHIVE =
  'UEsDBBQAAAAAAPRNLV17B5cKCAAAAAgAAAAPAAAAZGF0YS92YWx1ZXMuY3N2YSxiCjEsMgpQSwME' +
  'FAAAAAAA9E0tXYamEDYFAAAABQAAAAoAAAByZWFkbWUudHh0aGVsbG9QSwECFAAUAAAAAAD0TS1d' +
  'eweXCggAAAAIAAAADwAAAAAAAAAAAAAAAAAAAAAAZGF0YS92YWx1ZXMuY3N2UEsBAhQAFAAAAAAA' +
  '9E0tXYamEDYFAAAABQAAAAoAAAAAAAAAAAAAAAAANQAAAHJlYWRtZS50eHRQSwUGAAAAAAIAAgB1' +
  'AAAAYgAAAAAA';

/** An explicit `docs/` directory record beside `docs/a.txt` (5 bytes). */
export const NESTED_ARCHIVE =
  'UEsDBBQAAAAAAAROLV0AAAAAAAAAAAAAAAAFAAAAZG9jcy9QSwMEFAAAAAAABE4tXYamEDYFAAAA' +
  'BQAAAAoAAABkb2NzL2EudHh0aGVsbG9QSwECFAAUAAAAAAAETi1dAAAAAAAAAAAAAAAABQAAAAAA' +
  'AAAAAAAAAAAAAAAAZG9jcy9QSwECFAAUAAAAAAAETi1dhqYQNgUAAAAFAAAACgAAAAAAAAAAAAAA' +
  'AAAjAAAAZG9jcy9hLnR4dFBLBQYAAAAAAgACAGsAAABQAAAAAAA=';

/**
 * `PAIR_ARCHIVE` after an edit, for the tests that need two sides.
 *
 * `data/values.csv` is byte-identical, `notes.md` is new, and `readme.txt`
 * holds `world` where it held `hello` — five bytes either way. That last one is
 * the case the whole comparison is built around: its size is unchanged, so
 * anything comparing sizes would report the file as untouched.
 */
export const CHANGED_ARCHIVE =
  'UEsDBBQAAAAAABRPLV17B5cKCAAAAAgAAAAPAAAAZGF0YS92YWx1ZXMuY3N2YSxiCjEsMgpQSw' +
  'MEFAAAAAAAFE8tXawqk9gCAAAAAgAAAAgAAABub3Rlcy5tZGhpUEsDBBQAAAAAABRPLV1DEXc6' +
  'BQAAAAUAAAAKAAAAcmVhZG1lLnR4dHdvcmxkUEsBAhQAFAAAAAAAFE8tXXsHlwoIAAAACAAAAA' +
  '8AAAAAAAAAAAAAAAAAAAAAAGRhdGEvdmFsdWVzLmNzdlBLAQIUABQAAAAAABRPLV2sKpPYAgAA' +
  'AAIAAAAIAAAAAAAAAAAAAAAAADUAAABub3Rlcy5tZFBLAQIUABQAAAAAABRPLV1DEXc6BQAAAA' +
  'UAAAAKAAAAAAAAAAAAAAAAAF0AAAByZWFkbWUudHh0UEsFBgAAAAADAAMAqwAAAIoAAAAAAA==';
