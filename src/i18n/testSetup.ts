// Vitest setup (Stage 44.2): the app loads uk/de/ar dictionaries lazily; tests
// translate synchronously, so all four are registered up front.
import { registerDict } from './index';
import { UK } from './dictionaries/uk';
import { DE } from './dictionaries/de';
import { AR } from './dictionaries/ar';

registerDict('uk', UK);
registerDict('de', DE);
registerDict('ar', AR);
