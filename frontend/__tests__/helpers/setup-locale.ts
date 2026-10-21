// Vitest setup (vitest.config.ts → setupFiles): every test file starts on the
// same device — a phone in India with an English browser — so results never
// depend on the time zone or language of the machine running the tests.
// Tests about other countries or Hinglish wording switch with useDevice() /
// useHinglishSpeaker() from ./locale.
import { DEFAULT_TEST_DEVICE, useDevice } from './locale';

useDevice(DEFAULT_TEST_DEVICE);
