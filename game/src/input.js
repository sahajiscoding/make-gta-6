// Keyboard and mouse input with pointer lock, plus a tiny action-latch layer so
// gameplay code can ask "was pressed this frame" without caring about events.
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const released = new Set();
  const mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0, leftPressed: false, rightPressed: false };
  let locked = false;
  const listeners = [];

  function isTypingTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    const code = e.code;
    if (!keys.has(code)) pressed.add(code);
    keys.add(code);
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    for (const fn of listeners) fn(code, e);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    released.add(e.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    mouse.left = false;
    mouse.right = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) {
      mouse.left = true;
      mouse.leftPressed = true;
    }
    if (e.button === 2) {
      mouse.right = true;
      mouse.rightPressed = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouse.dx += e.movementX || 0;
    mouse.dy += e.movementY || 0;
  });
  window.addEventListener('wheel', (e) => {
    if (locked) mouse.wheel += Math.sign(e.deltaY);
  }, { passive: true });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });

  return {
    keys,
    mouse,
    get locked() {
      return locked;
    },
    lock() {
      if (!locked && canvas.requestPointerLock) {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      }
    },
    unlock() {
      if (document.exitPointerLock) document.exitPointerLock();
    },
    down(...codes) {
      return codes.some((c) => keys.has(c));
    },
    hit(...codes) {
      return codes.some((c) => pressed.has(c));
    },
    up(...codes) {
      return codes.some((c) => released.has(c));
    },
    onKey(fn) {
      listeners.push(fn);
    },
    endFrame() {
      pressed.clear();
      released.clear();
      mouse.dx = 0;
      mouse.dy = 0;
      mouse.wheel = 0;
      mouse.leftPressed = false;
      mouse.rightPressed = false;
    },
  };
}
