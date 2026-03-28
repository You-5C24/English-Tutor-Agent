import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// happy-dom 未实现 getAnimations，Base UI ScrollArea 会定时调用并产生未处理异常
if (typeof Element !== 'undefined' && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = function getAnimationsPolyfill() {
    return [];
  };
}

afterEach(() => {
  cleanup();
});
