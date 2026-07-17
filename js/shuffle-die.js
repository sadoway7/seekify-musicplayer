// ============================================
// shuffle-die.js — low-power 3D Shuffle All tile
// ============================================
window.ShuffleDie = (() => {
  const instances = new Set();

  const vertexSource = `
    attribute vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;

    uniform vec2 uResolution;
    uniform vec3 uRotation;

    mat3 rotateX(float a) {
      float c = cos(a), s = sin(a);
      return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
    }

    mat3 rotateY(float a) {
      float c = cos(a), s = sin(a);
      return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    }

    mat3 rotateZ(float a) {
      float c = cos(a), s = sin(a);
      return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
    }

    mat3 objectRotation() {
      return rotateZ(uRotation.z) * rotateY(uRotation.y) * rotateX(uRotation.x);
    }

    vec3 toLocal(vec3 p) {
      mat3 r = objectRotation();
      return vec3(dot(p, r[0]), dot(p, r[1]), dot(p, r[2]));
    }

    float roundedBox(vec3 p, vec3 bounds, float radius) {
      vec3 q = abs(p) - bounds + radius;
      return min(max(q.x, max(q.y, q.z)), 0.0)
        + length(max(q, 0.0)) - radius;
    }

    float cavitySphere(vec3 p, vec3 center) {
      return length(p - center) - 0.225;
    }

    float cavityDistance(vec3 p) {
      float d = 100.0;
      vec3 a = abs(p);
      float s = 0.43;
      float face = 1.16;

      if (a.z >= a.x && a.z >= a.y) {
        if (p.z > 0.0) {
          d = min(d, cavitySphere(p, vec3(-s, s, face)));
          d = min(d, cavitySphere(p, vec3(s, s, face)));
          d = min(d, cavitySphere(p, vec3(0.0, 0.0, face)));
          d = min(d, cavitySphere(p, vec3(-s, -s, face)));
          d = min(d, cavitySphere(p, vec3(s, -s, face)));
        } else {
          d = min(d, cavitySphere(p, vec3(-s, s, -face)));
          d = min(d, cavitySphere(p, vec3(s, s, -face)));
          d = min(d, cavitySphere(p, vec3(-s, 0.0, -face)));
          d = min(d, cavitySphere(p, vec3(s, 0.0, -face)));
          d = min(d, cavitySphere(p, vec3(-s, -s, -face)));
          d = min(d, cavitySphere(p, vec3(s, -s, -face)));
        }
      } else if (a.x >= a.y) {
        if (p.x > 0.0) {
          d = min(d, cavitySphere(p, vec3(face, s, s)));
          d = min(d, cavitySphere(p, vec3(face, s, -s)));
          d = min(d, cavitySphere(p, vec3(face, -s, s)));
          d = min(d, cavitySphere(p, vec3(face, -s, -s)));
        } else {
          d = min(d, cavitySphere(p, vec3(-face, s, -s)));
          d = min(d, cavitySphere(p, vec3(-face, 0.0, 0.0)));
          d = min(d, cavitySphere(p, vec3(-face, -s, s)));
        }
      } else if (p.y > 0.0) {
        d = cavitySphere(p, vec3(0.0, face, 0.0));
      } else {
        d = min(
          cavitySphere(p, vec3(-s, -face, s)),
          cavitySphere(p, vec3(s, -face, -s))
        );
      }
      return d;
    }

    float sceneDistance(vec3 p) {
      vec3 localPoint = toLocal(p);
      float bodyDistance = roundedBox(localPoint, vec3(1.0), 0.19);
      return max(bodyDistance, -cavityDistance(localPoint));
    }

    vec3 sceneNormal(vec3 p) {
      float e = 0.0025;
      return normalize(vec3(
        sceneDistance(p + vec3(e, 0.0, 0.0)) - sceneDistance(p - vec3(e, 0.0, 0.0)),
        sceneDistance(p + vec3(0.0, e, 0.0)) - sceneDistance(p - vec3(0.0, e, 0.0)),
        sceneDistance(p + vec3(0.0, 0.0, e)) - sceneDistance(p - vec3(0.0, 0.0, e))
      ));
    }

    float dotPip(vec2 p, vec2 center) {
      return 1.0 - smoothstep(0.145, 0.175, length(p - center));
    }

    float patternOne(vec2 p) {
      return dotPip(p, vec2(0.0));
    }

    float patternTwo(vec2 p) {
      return max(dotPip(p, vec2(-0.43, 0.43)), dotPip(p, vec2(0.43, -0.43)));
    }

    float patternThree(vec2 p) {
      float m = dotPip(p, vec2(-0.43, 0.43));
      m = max(m, dotPip(p, vec2(0.0)));
      return max(m, dotPip(p, vec2(0.43, -0.43)));
    }

    float patternFour(vec2 p) {
      float m = dotPip(p, vec2(-0.43, 0.43));
      m = max(m, dotPip(p, vec2(0.43, 0.43)));
      m = max(m, dotPip(p, vec2(-0.43, -0.43)));
      return max(m, dotPip(p, vec2(0.43, -0.43)));
    }

    float patternFive(vec2 p) {
      return max(patternFour(p), dotPip(p, vec2(0.0)));
    }

    float patternSix(vec2 p) {
      float m = patternFour(p);
      m = max(m, dotPip(p, vec2(-0.43, 0.0)));
      return max(m, dotPip(p, vec2(0.43, 0.0)));
    }

    float pipMask(vec3 p) {
      vec3 a = abs(p);
      if (a.z >= a.x && a.z >= a.y) {
        return p.z > 0.0 ? patternFive(vec2(p.x, p.y)) : patternSix(vec2(-p.x, p.y));
      }
      if (a.x >= a.y) {
        return p.x > 0.0 ? patternFour(vec2(-p.z, p.y)) : patternThree(vec2(p.z, p.y));
      }
      return p.y > 0.0 ? patternOne(vec2(p.x, -p.z)) : patternTwo(vec2(p.x, p.z));
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
      vec3 rayOrigin = vec3(0.0, 0.0, 6.2);
      vec3 rayDirection = normalize(vec3(uv * 1.02, -3.2));

      float travel = 0.0;
      bool hit = false;
      vec3 point = rayOrigin;
      for (int i = 0; i < 64; i++) {
        point = rayOrigin + rayDirection * travel;
        float distanceToScene = sceneDistance(point);
        if (distanceToScene < 0.0015) {
          hit = true;
          break;
        }
        travel += distanceToScene;
        if (travel > 9.0) break;
      }

      if (!hit) {
        gl_FragColor = vec4(0.0);
        return;
      }

      vec3 normal = sceneNormal(point);
      vec3 localPoint = toLocal(point);
      float pips = pipMask(localPoint);

      vec3 body = vec3(0.80, 0.81, 0.76);
      vec3 lime = vec3(0.66, 0.88, 0.05);
      vec3 surface = mix(body, lime, pips);

      vec3 lightDirection = normalize(vec3(-0.62, 0.88, 0.68));
      float wrappedLight = clamp((dot(normal, lightDirection) + 0.30) / 1.30, 0.0, 1.0);
      float toonLight = mix(0.50, 1.05, smoothstep(0.0, 1.0, wrappedLight));
      vec3 viewDirection = normalize(rayOrigin - point);
      vec3 halfDirection = normalize(lightDirection + viewDirection);
      float specular = smoothstep(0.86, 0.94, max(dot(normal, halfDirection), 0.0)) * 0.065;
      float facing = max(dot(normal, viewDirection), 0.0);
      vec3 color = surface * toonLight + specular + lime * pips * 0.04;
      float outline = 1.0 - smoothstep(0.05, 0.20, facing);
      color = mix(color, vec3(0.075, 0.082, 0.072), outline * 0.82);
      color = pow(color, vec3(1.0 / 2.2));
      float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      color += (dither - 0.5) / 320.0;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Shader compile failed';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function mount(canvas) {
    if (!canvas || canvas.dataset.shuffleDieMounted === 'true') return null;
    const stage = canvas.closest('.shuffle-die-stage');
    if (!stage) return null;

    canvas.dataset.shuffleDieMounted = 'true';
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power'
    });
    if (!gl) return null;

    let program;
    try {
      program = gl.createProgram();
      const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed');
      }
    } catch (error) {
      console.warn('Shuffle die unavailable:', error);
      return null;
    }

    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'aPosition');
    const resolution = gl.getUniformLocation(program, 'uResolution');
    const rotation = gl.getUniformLocation(program, 'uRotation');
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    let baseX = -0.40;
    let baseY = 0.58;
    let baseZ = -0.08;
    let dragging = false;
    let pointerMoved = false;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let spinning = false;
    let spinStart = 0;
    let visible = true;
    let disposed = false;
    let frame = 0;
    let lastFrameTime = 0;
    let hasDrawn = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
      const cssSize = Math.min(stage.clientWidth, stage.clientHeight);
      const scale = Math.min(devicePixelRatio || 1, 1.15);
      const size = Math.max(1, Math.round(cssSize * scale));
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
        gl.viewport(0, 0, size, size);
      }
    }

    function draw(time) {
      if (disposed) return;
      resize();
      const idleTime = time * 2.2;
      const idleX = reducedMotion || dragging ? 0
        : Math.sin(idleTime * 0.00009) * 0.36 + Math.sin(idleTime * 0.000031 + 1.7) * 0.18;
      const idleY = reducedMotion || dragging ? 0
        : Math.sin(idleTime * 0.000075 + 2.2) * 0.58 + Math.sin(idleTime * 0.000023) * 0.25;
      const idleZ = reducedMotion || dragging ? 0
        : Math.sin(idleTime * 0.000064 + 0.7) * 0.22 + Math.sin(idleTime * 0.000019 + 2.8) * 0.10;

      let spinX = 0;
      let spinY = 0;
      let spinZ = 0;
      if (spinning) {
        const progress = Math.min(1, (time - spinStart) / 900);
        const ramp = progress * progress * (3 - 2 * progress);
        spinX = ramp * Math.PI * 2;
        spinY = ramp * Math.PI * 4;
        spinZ = ramp * Math.PI * 2;
        if (progress >= 1) spinning = false;
      }

      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform3f(rotation, baseX + idleX + spinX, baseY + idleY + spinY, baseZ + idleZ + spinZ);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!hasDrawn) {
        hasDrawn = true;
        stage.classList.add('is-live');
      }
    }

    function animate(time) {
      frame = 0;
      if (disposed || !visible || document.hidden) return;
      if (!canvas.isConnected) {
        dispose();
        return;
      }
      const interval = dragging || spinning ? 16 : 50;
      if (time - lastFrameTime >= interval) {
        draw(time);
        lastFrameTime = time;
      }
      if (!reducedMotion || dragging || spinning) frame = requestAnimationFrame(animate);
    }

    function start() {
      if (disposed || frame || !visible || document.hidden) return;
      if (reducedMotion && !dragging && !spinning) draw(0);
      else frame = requestAnimationFrame(animate);
    }

    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    function onPointerDown(event) {
      dragging = true;
      pointerMoved = false;
      downX = event.clientX;
      downY = event.clientY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!reducedMotion) {
        spinning = true;
        spinStart = performance.now();
      }
      canvas.setPointerCapture(event.pointerId);
      start();
    }

    function onPointerMove(event) {
      if (!dragging) return;
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5) {
        pointerMoved = true;
        spinning = false;
      }
      baseY += (event.clientX - lastX) * 0.012;
      baseX += (event.clientY - lastY) * 0.012;
      baseX = Math.max(-1.35, Math.min(1.35, baseX));
      lastX = event.clientX;
      lastY = event.clientY;
      if (reducedMotion) draw(0);
    }

    function onPointerEnd(event) {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      start();
    }

    function onClick(event) {
      if (!pointerMoved) return;
      event.preventDefault();
      event.stopPropagation();
      pointerMoved = false;
    }

    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }

    const resizeObserver = new ResizeObserver(() => draw(0));
    resizeObserver.observe(stage);
    const intersectionObserver = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) start();
      else stop();
    }, { threshold: 0.05 });
    intersectionObserver.observe(canvas);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerEnd);
    canvas.addEventListener('pointercancel', onPointerEnd);
    canvas.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', onVisibilityChange);

    let instance;

    function dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      instances.delete(instance);
    }

    instance = { canvas, dispose };
    instances.add(instance);
    draw(0);
    start();
    return instance;
  }

  function mountAll(root = document) {
    for (const instance of Array.from(instances)) {
      if (!instance.canvas.isConnected) instance.dispose();
    }
    root.querySelectorAll('.shuffle-die-canvas').forEach(mount);
  }

  return { mount, mountAll };
})();
