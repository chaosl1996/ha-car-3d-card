(function () {
  'use strict';
  const DEFAULT_BASE = '/local/car3d';
  let _mods = null;
  function loadMods(base) {
    if (_mods) return Promise.resolve(_mods);
    // import() 相对路径基于脚本 URL 解析，先把相对 base 转为以 / 开头的绝对路径（基于页面 URL）
    let abs = base || DEFAULT_BASE;
    if (abs[0] !== '/' && !/^https?:/i.test(abs)) {
      try { abs = new URL(abs, document.baseURI).pathname; } catch (e) { abs = DEFAULT_BASE; }
    }
    return Promise.all([
      import(abs + '/three.module.js'),
      import(abs + '/GLTFLoader.js'),
      import(abs + '/OrbitControls.js'),
      // 后处理（UnrealBloom）：文件缺失时降级为直接渲染
      Promise.all([
        import(abs + '/EffectComposer.js').catch(() => null),
        import(abs + '/RenderPass.js').catch(() => null),
        import(abs + '/UnrealBloomPass.js').catch(() => null),
        import(abs + '/OutputPass.js').catch(() => null)
      ])
    ]).then(r => {
      const pp = r[3];
      const post = (pp[0] && pp[1] && pp[2] && pp[3]) ? {
        EffectComposer: pp[0].EffectComposer,
        RenderPass: pp[1].RenderPass,
        UnrealBloomPass: pp[2].UnrealBloomPass,
        OutputPass: pp[3].OutputPass
      } : null;
      _mods = { THREE: r[0], GLTFLoader: r[1].GLTFLoader, OrbitControls: r[2].OrbitControls, post };
      return _mods;
    });
  }

  // 铰链节点（模型内已有的动画 Dummy，位于各门铰链处）
  const DOOR_DUMMIES = {
    lf_door: 'Dummy001', lr_door: 'Dummy002',
    trunk: 'Dummy003',   // 侧开式尾门（备胎随门）
    rf_door: 'Dummy004', rr_door: 'Dummy005'
  };
  const TRUNK_EXTRA_DUMMY = 'Dummy010'; // 46_trunk_metal 也属于尾门
  const DOOR_GLASS = {
    lf_door: '26_lf_door_glass', lr_door: '32_lr_door_glass',
    rf_door: '35_rf_door_glass', rr_door: '41_rr_door_glass'
  };
  const EXTRA_GLASS = ['08_car_body_glass', 'rearBodyGlass', '13_car_top_glass', '45_trunk_glass', '60_plastic_tianchuang'];
  // 真车灯节点（严格匹配；牌照/内饰/轮胎等 map_c 全部排除）
  const HEAD_LIGHT_NAMES = ['17_headlight_map_c'];
  const TAIL_LIGHT_NAMES = ['48_trunk_light_map_c', 'rearLampBand', 'rearLampGlass'];
  const WHEEL_DUMMIES = ['Dummy006', 'Dummy007'];

  function readState(hass, ent) {
    if (!ent || !hass) return null;
    const st = hass.states[ent];
    return st ? st.state : null;
  }
  function readAttr(hass, ent, attr) {
    if (!ent || !hass) return null;
    const st = hass.states[ent];
    return st && st.attributes ? st.attributes[attr] : null;
  }
  function isTruthy(s) {
    return s === 'on' || s === 'open' || s === 'unlocked' || s === true;
  }
  function toNum(v, d) {
    const n = parseFloat(v); return isNaN(n) ? d : n;
  }
  function baseName(n) { return n.replace(/(_\d+)|\.\d+$/, ''); }

  class Car3DCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._loaded = false;
      this._raf = null; this._ro = null;
      this._doors = []; this._headLights = []; this._tailLights = [];
      this._wheels = []; this._windows = []; this._lampEffects = [];
      this._lightColor = null; this._tailLightColor = null;
      this._trunkPivot = null; this._forward = null; this._widthAxis = null;
    }

    setConfig(config) {
      this._cleanup();
      this._config = Object.assign({
        base: DEFAULT_BASE,
        model: null,
        title: '',
        height: 400,
        bg_color: '#0e0e0e',
        model_rotation: 180,   // 水平朝向（绕垂直轴）
        model_fix_roll: -90,   // 姿态修正：模型 +Z 为上（IFC Z-up），绕 X 轴 -90° 使 +Z → +Y
        door_angle: 62,
        trunk_angle: 75,
        light_color: '#fff2cc',
        auto_rotate: false,
        rotate_speed: 1.0,
        wheel_spin: false,
        show_ground: true,
        show_beam: true,
        beam_intensity: 0.5,
        spotlight: true,
        bloom_strength: 0.55,   // 泛光强度
        bloom_radius: 0.55,     // 泛光羽化半径
        bloom_threshold: 1.0,   // 泛光阈值（仅过曝高亮发光）
        plate_number: '',
        plate_type: 'blue',    // blue | green
        // 灯位比例定位（front: 沿车长占半长比例, side: 占半宽比例, height: 离地占车高比例）
        headlight_pos: { front: 0.85, side: 0.70, height: 0.48 },
        taillight_pos: { front: 0.88, side: 0.76, height: 0.47 },
        plate_height: 0.34,   // 前牌离地高度占车高比例
        plate_rear: { front: 0.97, side: 0.50, height: 0.31, tilt: 7 },  // 后牌：保险杠牌照位；tilt=竖向微旋角(°)，正=从车后看右缘向外
        door_entities: null,
        door_lock_entity: null,
        headlight_entity: null,
        taillight_entity: null,
        light_entity: null,
        window_entity: null,
        tpms: { lf: null, rf: null, lr: null, rr: null, unit: 'bar', temp: { lf: null, rf: null, lr: null, rr: null } },
        fuel_entity: null,
        auto_rotate_entity: null
      }, config || {});
      this._config.tpms = Object.assign({ lf: null, rf: null, lr: null, rr: null, unit: 'bar', temp: { lf: null, rf: null, lr: null, rr: null } }, (config && config.tpms) || {});
      this._config.tpms.temp = Object.assign({ lf: null, rf: null, lr: null, rr: null }, (config && config.tpms && config.tpms.temp) || {});
      this._config.headlight_pos = Object.assign({ front: 0.85, side: 0.70, height: 0.48 }, (config && config.headlight_pos) || {});
      this._config.taillight_pos = Object.assign({ front: 0.88, side: 0.76, height: 0.47 }, (config && config.taillight_pos) || {});
      this._config.plate_rear = Object.assign({ front: 0.97, side: 0.50, height: 0.31, tilt: 7 }, (config && config.plate_rear) || {});
      if (!this._config.model) this._config.model = this._config.base + '/weimingming.glb';
      this._buildShell();
      this._init();
    }
    set hass(hass) { this._hass = hass; this._applyState(); }
    getCardSize() { return Math.ceil(this._config.height / 120); }
    static getConfigElement() {
      const el = document.createElement('car-3d-card-editor');
      return Promise.resolve(el);
    }
    static getStubConfig() {
      return {
        title: '我的汽车',
        plate_number: '',
        plate_type: 'blue',
        bg_color: '#0e0e0e',
        auto_rotate: false,
        rotate_speed: 1.0,
        height: 400
      };
    }

    _cleanup() {
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._renderer) { try { this._renderer.dispose(); } catch (e) {} }
      if (this._ro) { try { this._ro.disconnect(); } catch (e) {} }
      this._loaded = false;
      this._doors = []; this._headLights = []; this._tailLights = [];
      this._wheels = []; this._windows = []; this._lampEffects = [];
      this._lightColor = null; this._controls = null; this._trunkPivot = null;
    }

    _buildShell() {
      const root = this.shadowRoot;
      root.innerHTML = '';
      const card = document.createElement('ha-card');
      card.style.cssText = 'display:block;overflow:hidden;border-radius:12px;';
      if (this._config.title) {
        const t = document.createElement('div');
        t.textContent = this._config.title;
        t.style.cssText = 'padding:10px 16px 0;font-weight:600;color:var(--primary-text-color,#fff)';
        card.appendChild(t);
      }
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:100%;height:' + this._config.height + 'px;background:' + this._config.bg_color + ';';
      const tip = document.createElement('div');
      tip.textContent = '3D 模型加载中…';
      tip.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:14px;';
      wrap.appendChild(tip);
      this._wrap = wrap; this._tip = tip;
      card.appendChild(wrap);

      const hud = document.createElement('div');
      hud.style.cssText = 'position:absolute;left:10px;bottom:10px;right:10px;display:flex;justify-content:space-between;align-items:flex-end;pointer-events:none;font-size:12px;color:var(--primary-text-color,#fff);text-shadow:0 1px 2px rgba(0,0,0,.8);';
      const tpmsBox = document.createElement('div');
      tpmsBox.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(44px,auto));gap:3px 8px;background:rgba(0,0,0,.35);padding:6px 8px;border-radius:8px;';
      ['lf', 'rf', 'lr', 'rr'].forEach(pos => {
        const b = document.createElement('div');
        const n = document.createElement('span');
        const posMap = { lf: 'FL', rf: 'FR', lr: 'RL', rr: 'RR' };
        n.textContent = posMap[pos];
        n.style.cssText = 'display:inline-block;width:18px;color:#8cf;font-weight:600;';
        const v = document.createElement('span');
        v.textContent = '--';
        v.dataset.k = 'tpms-' + pos;
        b.appendChild(n); b.appendChild(v);
        tpmsBox.appendChild(b);
      });
      hud.appendChild(tpmsBox);
      this._tpmsBox = tpmsBox;
      const centerBox = document.createElement('div');
      centerBox.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:center;';
      this._rotateBtn = null;
      if (this._config.auto_rotate_entity) {
        const rb = document.createElement('button');
        rb.style.cssText = 'appearance:none;border:1px solid #4a8bff;background:rgba(20,60,120,.55);color:#e6efff;padding:4px 10px;border-radius:16px;font-size:12px;cursor:pointer;pointer-events:auto;';
        rb.textContent = '自转 关';
        rb.addEventListener('click', () => this._toggleRotate());
        centerBox.appendChild(rb);
        this._rotateBtn = rb;
      }
      hud.appendChild(centerBox);
      const rightBox = document.createElement('div');
      rightBox.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:flex-end;';
      const fuelBox = document.createElement('div');
      fuelBox.style.cssText = 'background:rgba(0,0,0,.35);padding:6px 10px;border-radius:8px;min-width:84px;';
      const fuelTitle = document.createElement('div');
      fuelTitle.style.cssText = 'color:#fc8;font-weight:600;';
      fuelTitle.textContent = '油量';
      const fuelBar = document.createElement('div');
      fuelBar.style.cssText = 'width:80px;height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden;margin-top:2px;';
      const fuelFill = document.createElement('div');
      fuelFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#fa3,#fd6);transition:width .3s;';
      fuelFill.dataset.k = 'fuel-bar';
      fuelBar.appendChild(fuelFill);
      const fuelText = document.createElement('div');
      fuelText.style.cssText = 'font-size:12px;margin-top:2px;';
      fuelText.dataset.k = 'fuel-text';
      fuelText.textContent = '--';
      fuelBox.appendChild(fuelTitle); fuelBox.appendChild(fuelBar); fuelBox.appendChild(fuelText);
      rightBox.appendChild(fuelBox);
      hud.appendChild(rightBox);
      wrap.appendChild(hud);
      this._hud = hud;

      // 俯视模式：四轮毂胎压+温度标签（点击车身进入俯视时显示）
      this._wheelTags = {};
      const posName = { lf: '左前', rf: '右前', lr: '左后', rr: '右后' };
      ['lf', 'rf', 'lr', 'rr'].forEach(k => {
        const d = document.createElement('div');
        d.style.cssText = 'position:absolute;transform:translate(-50%,-120%);display:none;background:rgba(0,0,0,.72);border:1px solid rgba(120,180,255,.35);border-radius:8px;padding:4px 9px;font-size:11px;color:#fff;pointer-events:none;text-align:center;white-space:nowrap;text-shadow:0 1px 2px #000;z-index:2;';
        d.innerHTML = '<div style="color:#8cf;font-weight:600">' + posName[k] +
          ' <span data-k="wtemp-' + k + '" style="color:#fc8"></span></div>' +
          '<div data-k="wp-' + k + '" style="font-size:14px;font-weight:700">--</div>';
        wrap.appendChild(d);
        this._wheelTags[k] = d;
      });

      root.appendChild(card);
    }

    _toggleRotate() {
      const ent = this._config.auto_rotate_entity;
      if (!ent || !this._hass) return;
      const cur = readState(this._hass, ent);
      const next = isTruthy(cur) ? 'off' : 'on';
      const domain = ent.split('.')[0];
      const svc = next === 'on' ? 'turn_on' : 'turn_off';
      const hass = this._hass;
      try {
        if (typeof hass.callService === 'function') hass.callService(domain, svc, { entity_id: ent });
        else if (hass.connection) hass.connection.callService(domain, svc, { entity_id: ent });
      } catch (e) { /* ignore */ }
    }

    // ===== 俯视模式：点击车身进入/退出 =====
    _toggleTopView() {
      const T = this.THREE;
      if (!T || !this._camera || !this._controls || this._camTween) return;
      if (this._topView) {
        const sv = this._savedView || { pos: new T.Vector3(4.6, 2.4, 5.6), target: new T.Vector3(0, 0.3, 0) };
        this._startCamTween(sv.pos.clone(), sv.target.clone());
        this._topView = false;
      } else {
        this._savedView = { pos: this._camera.position.clone(), target: this._controls.target.clone() };
        // 相机在车尾正上方，视线朝车头 → 屏幕上方=车头
        const center = this._carBox.getCenter(new T.Vector3());
        const carH = this._carBox.max.y - this._groundY;
        center.y = this._groundY + carH * 0.5;
        const fR = this._projRange(this._carBox, this._forward);
        const halfLen = (fR.hi - fR.lo) / 2;
        const wR = this._projRange(this._carBox, this._widthAxis);
        const halfW = (wR.hi - wR.lo) / 2;
        const span = Math.max(halfLen * 2, halfW * 2);
        const pos = center.clone().addScaledVector(this._forward, -halfLen * 0.42);
        pos.y = center.y + span * 1.15 + 1.4;
        this._startCamTween(pos, center);
        this._topView = true;
        this._controls.autoRotate = false; // 俯视下不旋转
      }
      this._updateTopHud();
    }

    _startCamTween(toPos, toTarget) {
      this._camTween = {
        t: 0, dur: 700,
        fromPos: this._camera.position.clone(), toPos: toPos.clone(),
        fromTgt: this._controls.target.clone(), toTgt: toTarget.clone()
      };
    }

    _updateTopHud() {
      const on = !!this._topView;
      Object.keys(this._wheelTags || {}).forEach(k => {
        const d = this._wheelTags[k];
        if (d) d.style.display = on ? 'block' : 'none';
      });
      if (this._tpmsBox) this._tpmsBox.style.display = on ? 'none' : 'grid';
    }

    async _init() {
      try {
        const { THREE, GLTFLoader, OrbitControls, post } = await loadMods(this._config.base);
        this.THREE = THREE;
        const wrap = this._wrap;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        const w0 = wrap.clientWidth || 400, h0 = wrap.clientHeight || this._config.height;
        renderer.setSize(w0, h0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        wrap.insertBefore(renderer.domElement, wrap.firstChild);
        this._renderer = renderer;
        this._post = post || null;
        this._composer = null;

        const scene = new THREE.Scene();
        this._scene = scene;

        // ===== 环境光照（PMREM 程序化环境贴图 → 车漆真实反射）=====
        try {
          const pmrem = new THREE.PMREMGenerator(renderer);
          const envScene = new THREE.Scene();
          const mkPanel = (r, g, b, w, h, pos) => {
            const m = new THREE.Mesh(
              new THREE.PlaneGeometry(w, h),
              new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r, g, b), side: THREE.DoubleSide })
            );
            m.position.copy(pos); m.lookAt(new THREE.Vector3(0, 0, 0)); envScene.add(m);
          };
          mkPanel(5, 5, 5.2, 12, 12, new THREE.Vector3(0, 10, 0));     // 顶部主光
          mkPanel(2.2, 2.1, 1.9, 8, 5, new THREE.Vector3(8, 4, 6));    // 前侧暖光
          mkPanel(1.3, 1.5, 2.0, 8, 5, new THREE.Vector3(-8, 4, -6));  // 后侧冷光
          mkPanel(0.8, 0.85, 1.0, 6, 4, new THREE.Vector3(0, 3, -10)); // 背面补光
          envScene.background = new THREE.Color().setRGB(0.05, 0.05, 0.06);
          scene.environment = pmrem.fromScene(envScene, 0.04).texture;
          pmrem.dispose();
        } catch (e) { /* 环境贴图失败时退回基础光照 */ }

        scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1a1a, 0.35));
        const dir = new THREE.DirectionalLight(0xfff4e0, 1.6);
        dir.position.set(5, 9, 6);
        dir.castShadow = true;
        dir.shadow.mapSize.set(2048, 2048);
        dir.shadow.camera.left = -4; dir.shadow.camera.right = 4;
        dir.shadow.camera.top = 4; dir.shadow.camera.bottom = -4;
        dir.shadow.camera.far = 30;
        dir.shadow.bias = -0.0004;
        dir.shadow.radius = 4;
        scene.add(dir);
        const dir2 = new THREE.DirectionalLight(0xbcd2ff, 0.45);
        dir2.position.set(-6, 4, -5); scene.add(dir2);

        const camera = new THREE.PerspectiveCamera(42, w0 / h0, 0.1, 1000);
        camera.position.set(4.6, 2.4, 5.6);
        this._camera = camera;

        // ===== 后处理管线：Render → UnrealBloom → Output(ACES+sRGB) =====
        // 灯光真实感走物理路径：灯体 emissive 过曝 → bloom 自然泛光
        if (this._post) {
          try {
            const composer = new this._post.EffectComposer(renderer);
            composer.addPass(new this._post.RenderPass(scene, camera));
            composer.addPass(new this._post.UnrealBloomPass(
              new THREE.Vector2(w0, h0),
              toNum(this._config.bloom_strength, 0.55),
              toNum(this._config.bloom_radius, 0.55),
              toNum(this._config.bloom_threshold, 1.0)
            ));
            composer.addPass(new this._post.OutputPass());
            this._composer = composer;
          } catch (e) { console.warn('[car-3d-card] bloom unavailable', e); this._composer = null; }
        }

        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(this._config.model);
        const model = gltf.scene;
        this._model = model;

        // ===== 归一化尺寸 + 居中 =====
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        model.scale.setScalar(3.2 / maxDim);
        const box2 = new THREE.Box3().setFromObject(model);
        const c2 = box2.getCenter(new THREE.Vector3());
        model.position.sub(c2);

        // ===== 姿态：先绕 X 翻正（-Z→+Y），再绕 Y 水平朝向 =====
        const rollGroup = new THREE.Group();
        rollGroup.rotation.x = THREE.MathUtils.degToRad(toNum(this._config.model_fix_roll, 90));
        const yawGroup = new THREE.Group();
        yawGroup.rotation.y = THREE.MathUtils.degToRad(toNum(this._config.model_rotation, 0));
        rollGroup.add(model);
        yawGroup.add(rollGroup);
        scene.add(yawGroup);
        scene.updateMatrixWorld(true);

        this._carBox = new THREE.Box3().setFromObject(model);
        this._groundY = this._carBox.min.y;

        // 车身轴向（直接由 model_rotation 推导，不依赖 mesh 几何）
        // 模型空间车头 = -x（前门铰链 x=-0.875 < 后门 x=+0.185 < 尾门 x=+2.068）
        // roll(90°) 不改 x，yaw(ry) 后车头方向 = (-cos(ry), 0, sin(ry))
        const ry = THREE.MathUtils.degToRad(toNum(this._config.model_rotation, 0));
        this._forward = new THREE.Vector3(-Math.cos(ry), 0, Math.sin(ry));
        this._widthAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this._forward).normalize();

        // 包围盒在任意轴上的投影范围
        const projRange = (b, axis) => {
          const ctr = b.getCenter(new THREE.Vector3());
          let lo = Infinity, hi = -Infinity;
          [b.min, b.max,
           new THREE.Vector3(b.min.x, b.min.y, b.max.z), new THREE.Vector3(b.min.x, b.max.y, b.min.z),
           new THREE.Vector3(b.max.x, b.min.y, b.min.z), new THREE.Vector3(b.min.x, b.max.y, b.max.z),
           new THREE.Vector3(b.max.x, b.min.y, b.max.z), new THREE.Vector3(b.max.x, b.max.y, b.min.z)
          ].forEach(p => {
            const d = p.clone().sub(ctr).dot(axis);
            if (d < lo) lo = d; if (d > hi) hi = d;
          });
          return { lo, hi };
        };
        this._projRange = projRange;

        // 地面（径向渐隐，接收阴影与车灯投影）
        if (this._config.show_ground) {
          const gsize = 3.2 * 1.4;
          const gc = document.createElement('canvas'); gc.width = gc.height = 256;
          const gctx = gc.getContext('2d');
          const grad = gctx.createRadialGradient(128, 128, 10, 128, 128, 128);
          grad.addColorStop(0, '#26262a');
          grad.addColorStop(0.55, '#141416');
          grad.addColorStop(1, '#0c0c0e');
          gctx.fillStyle = grad; gctx.fillRect(0, 0, 256, 256);
          const gTex = new THREE.CanvasTexture(gc); gTex.colorSpace = THREE.SRGBColorSpace;
          const ground = new THREE.Mesh(
            new THREE.CircleGeometry(gsize, 64),
            new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.92, metalness: 0.05 })
          );
          ground.rotation.x = -Math.PI / 2;
          ground.position.y = this._groundY + 0.002;
          ground.receiveShadow = true;
          scene.add(ground);
          this._ground = ground;
        }

        model.traverse(o => {
          if (o.name && /^Ifc(Building|Site|Project|BuildingStorey)/.test(o.name)) o.visible = false;
          // 隐藏前挡底胚（IFC 导出的白色不透明面板，盖在前挡玻璃后面导致玻璃永远不透明）
          if (o.name && /^59_plastic_(dipei|ZG)$/.test(o.name)) o.visible = false;
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
          if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = 0.9;
        });

        // 车门内饰黑色化（GLB 内饰材质偏红）
        model.traverse(o => {
          if (!o.isMesh || !o.name || !/inner_map_c/.test(o.name)) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { if (m && m.color) m.color.set(0x1a1a1a); });
        });

        // ===== 材质修正（模型导出时颜色/质感丢失）=====
        // 顺序在车灯采集之前，使灯光开/关恢复到修正后的基准值
        const MAT_FIX = [
          // 底盘/底座件：纯白 → 哑光黑
          { test: /underpan|taban|dipei/i, color: 0x121316, roughness: 0.9, metalness: 0.05 },
          // 大灯灯碗与金属圈：纯白 → 深灰金属
          { test: /15_headlight_black_plastic|16_headlight_metal/i, color: 0x26292e, roughness: 0.5, metalness: 0.55 },
          // 大灯发光面：降亮度 + 关灯时微弱灯碗反光
          { test: /17_headlight_map_c/i, color: 0xb9bec4, roughness: 0.28, metalness: 0.1, emissive: 0x3d3a33, emissiveIntensity: 0.3 },
          // 大灯玻璃罩：半透明
          { test: /14_headlight_glass/i, color: 0xffffff, roughness: 0.06, metalness: 0.0, opacity: 0.22 },
          // 尾灯：暗红基底 + 关灯时微红余辉
          { test: /48_trunk_light_map_c/i, color: 0x6e1212, roughness: 0.35, metalness: 0.05, emissive: 0x2a0505, emissiveIntensity: 0.5 },
          // 后视镜：纯金属黑（反射异常）→ 黑塑料
          { test: /mirror/i, color: 0x15171a, roughness: 0.42, metalness: 0.25 }
        ];
        model.traverse(o => {
          if (!o.isMesh || !o.name) return;
          for (const f of MAT_FIX) {
            if (!f.test.test(o.name)) continue;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(m => {
              if (!m || !m.color) return;
              if (f.color != null) m.color.set(f.color);
              if (f.roughness != null) m.roughness = f.roughness;
              if (f.metalness != null) m.metalness = f.metalness;
              if (f.emissive != null && m.emissive) m.emissive.set(f.emissive);
              if (f.emissiveIntensity != null) m.emissiveIntensity = f.emissiveIntensity;
              if (f.opacity != null) { m.opacity = f.opacity; m.transparent = true; }
            });
            break;
          }
        });

        // 车轮（自转可选，默认关）
        this._wheels = [];
        WHEEL_DUMMIES.forEach(dn => {
          const d = model.getObjectByName(dn);
          if (d) d.traverse(c => { if (c.isMesh) this._wheels.push(c); });
        });

        // ===== mesh 拆分（几何横贯全车的部件按局部 x 分车头/车尾两段）=====
        // 相关节点均无平移、旋转仅绕 X 轴 → 局部 x 即车长方向坐标。
        // 拆出 mesh 命名避开 "_数字"（baseName 会剥掉 _N 后缀导致名单匹配失效）。
        const splitByX = (name, rearName, rearMat) => {
          const src = model.getObjectByName(name);
          if (!src || !src.geometry || !src.geometry.attributes.position) return;
          const geom = src.geometry;
          const pos = geom.attributes.position;
          const idx = geom.index;
          const triCount = idx ? idx.count / 3 : pos.count / 3;
          const front = [], rear = [];
          for (let t = 0; t < triCount; t++) {
            const a = idx ? idx.getX(t * 3) : t * 3;
            const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
            const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
            const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
            (cx > 0 ? rear : front).push(a, b, c);
          }
          if (!rear.length || !front.length) return;
          geom.setIndex(front);
          const gRear = geom.clone();
          gRear.setIndex(rear);
          const rearMesh = new THREE.Mesh(gRear, rearMat);
          rearMesh.name = rearName;
          rearMesh.position.copy(src.position);
          rearMesh.quaternion.copy(src.quaternion);
          rearMesh.scale.copy(src.scale);
          rearMesh.castShadow = true;
          src.parent.add(rearMesh);
        };
        // 灯带：车头段=白大灯，车尾段=红尾灯（导出时被统一成白色）
        splitByX('17_headlight_map_c', 'rearLampBand', new THREE.MeshStandardMaterial({
          color: 0x6e1212, roughness: 0.35, metalness: 0.05,
          emissive: new THREE.Color(0x2a0505), emissiveIntensity: 0.5
        }));
        // 灯罩：统一无色透明（颜色由内部灯面透出）
        splitByX('14_headlight_glass', 'rearLampGlass', new THREE.MeshStandardMaterial({
          color: 0xffffff, roughness: 0.06, metalness: 0.0,
          transparent: true, opacity: 0.28
        }));
        // 车身玻璃：x<0 前挡保持透亮，x>0 的后侧角窗拆出（单独调暗）
        splitByX('08_car_body_glass', 'rearBodyGlass', new THREE.MeshStandardMaterial({
          color: 0x99b3bf, roughness: 0.12, metalness: 0.0,
          transparent: true, opacity: 0.25
        }));

        // ===== 车窗（前挡 0.35；其余略暗 0.45；门玻璃随窗状态 0.45↔0.05）=====
        this._windows = [];
        model.traverse(o => {
          if (!o.isMesh) return;
          const bnm = baseName(o.name || '');
          let type = null;
          for (const k of Object.keys(DOOR_GLASS)) if (DOOR_GLASS[k] === bnm) { type = 'door'; break; }
          if (!type && bnm === '08_car_body_glass') type = 'windshield';
          if (!type && EXTRA_GLASS.indexOf(bnm) >= 0) type = 'top';
          if (!type) return;
          const mats = Array.isArray(o.material) ? o.material.slice() : [o.material];
          const saved = mats.map(m => ({ m, o: m.opacity ?? 1, tm: m.transparent ?? false }));
          const base = type === 'windshield' ? 0.22 : 0.45;
          saved.forEach(s => {
            if (!s.m) return;
            if (type === 'windshield') {
              // 前挡：弃用原白雾贴图材质，重建高透玻璃（透亮不浑浊）
              const nm = new THREE.MeshPhysicalMaterial({
                color: 0xd6e9f5, roughness: 0.05, metalness: 0,
                transparent: true, opacity: base,
                envMapIntensity: 1.2, clearcoat: 1, clearcoatRoughness: 0.06
              });
              if (Array.isArray(o.material) && mats.length > 1) {
                const bi = mats.indexOf(s.m); if (bi >= 0) o.material[bi] = nm;
              } else o.material = nm;
              s.m = nm;
            } else {
              s.m.opacity = base; s.m.transparent = true;
              s.m.color.multiplyScalar(0.72); // 除前挡外整体调暗
            }
          });
          this._windows.push({ mesh: o, type, saved, base });
        });

        // ===== 车灯 mesh（严格匹配，排除牌照等）=====
        this._headLights = []; this._tailLights = [];
        model.traverse(o => {
          if (!o.isMesh || !o.name) return;
          const bnm = baseName(o.name);
          const nm = o.name.toLowerCase();
          if (/plate|license|chepai|paizhao/.test(nm)) return;
          const mats = Array.isArray(o.material) ? o.material.slice() : [o.material];
          const saved = mats.map(m => ({
            m, e: m.emissive ? m.emissive.clone() : new THREE.Color(0),
            ei: m.emissiveIntensity ?? 0, tm: m.toneMapped ?? true
          }));
          if (HEAD_LIGHT_NAMES.indexOf(bnm) >= 0) this._headLights.push({ mesh: o, saved });
          else if (TAIL_LIGHT_NAMES.indexOf(bnm) >= 0) this._tailLights.push({ mesh: o, saved });
        });

        // ===== 车门：世界对齐 pivot + attach，全部绕垂直轴旋转 =====
        this._doors = [];
        Object.keys(DOOR_DUMMIES).forEach(part => {
          const dummy = model.getObjectByName(DOOR_DUMMIES[part]);
          if (!dummy) return;
          // 模型默认姿势为门全开：Dummy 自带绕模型竖直轴的开门旋转。
          // 必须先在模型层级内归零旋转回到闭合姿势，再 attach 到世界对齐 pivot；
          // 若 attach 后再归零，会连姿态修正(roll/yaw)一起抹掉，导致门拍平贴地。
          // 例外：尾门(Dummy003/010)的旋转是层级姿态的一部分（归零会整体移位到
          // 车身中段），保留原始旋转即为其闭合状态。
          if (part !== 'trunk') dummy.quaternion.set(0, 0, 0, 1);
          model.updateMatrixWorld(true);
          const hingeW = new THREE.Vector3();
          dummy.getWorldPosition(hingeW);
          const pivot = new THREE.Object3D();
          pivot.position.copy(hingeW);
          scene.add(pivot);
          pivot.attach(dummy); // 保持世界变换，把门挂到世界对齐的 pivot 下
          if (part === 'trunk') {
            const extra = model.getObjectByName(TRUNK_EXTRA_DUMMY);
            if (extra) pivot.attach(extra);
            this._trunkPivot = pivot;
          }
          scene.updateMatrixWorld(true);
          const doorBox = new THREE.Box3().setFromObject(dummy);
          const centerW = doorBox.getCenter(new THREE.Vector3());
          // 自动判断外开方向：绕世界Y转 ±20°，取门中心离车中心更远的方向
          const fx = centerW.x - hingeW.x, fz = centerW.z - hingeW.z;
          const testDir = (sign) => {
            const a = sign * THREE.MathUtils.degToRad(20);
            const rx = fx * Math.cos(a) + fz * Math.sin(a);
            const rz = -fx * Math.sin(a) + fz * Math.cos(a);
            return (hingeW.x + rx) * (hingeW.x + rx) + (hingeW.z + rz) * (hingeW.z + rz);
          };
          const dir = testDir(1) >= testDir(-1) ? 1 : -1;
          this._doors.push({ pivot, part, dir, target: 0, current: 0 });
        });

        // 门闭合后重算整车包围盒（门开时车宽虚大导致灯位/车牌外偏）
        scene.updateMatrixWorld(true);
        this._carBox.setFromObject(model);
        this._groundY = this._carBox.min.y;
        if (this._ground) this._ground.position.y = this._groundY + 0.002;

        // ===== 灯光特效（按整车包围盒比例定位，避免几何偏移导致灯位漂移）=====
        this._lampEffects = [];
        this._buildLampPositions();

        // ===== 车牌 =====
        if (this._config.plate_number) this._buildPlates();

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 3;
        controls.maxDistance = 14;
        controls.maxPolarAngle = Math.PI / 2.05;
        controls.target.set(0, 0.3, 0);
        controls.update();
        this._controls = controls;

        // ===== 四轮世界坐标（俯视轮毂标签定位）=====
        this._wheelWorld = null;
        this._topView = false; this._camTween = null; this._savedView = null;
        try {
          const fa = model.getObjectByName('19_tire_map_c'); // 前轴轮组
          const ra = model.getObjectByName('20_tire_map_c'); // 后轴轮组
          if (fa && ra) {
            // 用左前门铰链在世界宽轴上的符号定义"左"
            const lfHinge = model.getObjectByName('Dummy001');
            let leftSign = -1;
            if (lfHinge) {
              const hp = new THREE.Vector3(); lfHinge.getWorldPosition(hp);
              leftSign = hp.dot(this._widthAxis) >= 0 ? 1 : -1;
            }
            const mkAxle = (axle) => {
              const b = new THREE.Box3().setFromObject(axle);
              return {
                ctr: b.getCenter(new THREE.Vector3()),
                half: (this._projRange(b, this._widthAxis).hi - this._projRange(b, this._widthAxis).lo) / 2
              };
            };
            const F = mkAxle(fa), R = mkAxle(ra);
            const off = 0.78; // 轮心占半轮距比例（轮胎几何横贯左右两侧）
            // 车身左侧 = 面向车头时左手边 = forward × up 方向
            const leftDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this._forward).normalize();
            this._wheelWorld = {
              lf: F.ctr.clone().addScaledVector(leftDir, F.half * off),
              rf: F.ctr.clone().addScaledVector(leftDir, -F.half * off),
              lr: R.ctr.clone().addScaledVector(leftDir, R.half * off),
              rr: R.ctr.clone().addScaledVector(leftDir, -R.half * off)
            };
          }
        } catch (e) { /* 轮位获取失败则俯视无标签 */ }

        // ===== 点击车身切换俯视（区分拖拽：位移>5px 不算点击）=====
        let pdown = null;
        renderer.domElement.addEventListener('pointerdown', e => { pdown = { x: e.clientX, y: e.clientY }; });
        renderer.domElement.addEventListener('pointerup', e => {
          if (!pdown) return;
          const dx = e.clientX - pdown.x, dy = e.clientY - pdown.y;
          pdown = null;
          if (dx * dx + dy * dy > 25) return;
          const r = renderer.domElement.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            -((e.clientY - r.top) / r.height) * 2 + 1
          );
          const ray = new THREE.Raycaster();
          ray.setFromCamera(ndc, camera);
          const carObjs = [model];
          (this._doors || []).forEach(d => carObjs.push(d.pivot));
          (this._plateMeshes || []).forEach(m => carObjs.push(m));
          if (ray.intersectObjects(carObjs, true).length) this._toggleTopView();
        });

        this._loaded = true;
        if (this._tip) this._tip.style.display = 'none';
        this._applyState();
        this._ro = new ResizeObserver(() => this._onResize());
        this._ro.observe(wrap);
        this._animate();
      } catch (e) {
        console.error('[car-3d-card] init failed', e);
        if (this._tip) {
          this._tip.textContent = '加载失败: ' + (e && e.message || e);
          this._tip.style.color = '#f76';
        }
      }
    }

    // 按整车包围盒 + 比例计算左右灯位（世界坐标）
    _buildLampPositions() {
      const THREE = this.THREE, c = this._config;
      const fR = this._projRange(this._carBox, this._forward);
      const wR = this._projRange(this._carBox, this._widthAxis);
      const center = this._carBox.getCenter(new THREE.Vector3());
      const halfLen = (fR.hi - fR.lo) / 2;
      const halfW = (wR.hi - wR.lo) / 2;
      const carH = this._carBox.max.y - this._groundY;

      const mkPos = (sign, posCfg) => {
        const p = center.clone()
          .add(this._forward.clone().multiplyScalar(sign * halfLen * posCfg.front))
          .add(this._widthAxis.clone().multiplyScalar(halfW * posCfg.side));
        p.y = this._groundY + carH * posCfg.height;
        return p;
      };
      const hp = c.headlight_pos, tp = c.taillight_pos;
      const headLamps = [mkPos(1, hp), mkPos(1, Object.assign({}, hp, { side: -hp.side }))];
      const tailLamps = [mkPos(-1, tp), mkPos(-1, Object.assign({}, tp, { side: -tp.side }))];

      this._buildLampEffects(headLamps, true);
      this._buildLampEffects(tailLamps, false);
    }


    _buildLampEffects(positions, isHead) {
      const THREE = this.THREE;
      const c = this._config;
      const color = isHead ? c.light_color : '#ff2a1a';
      positions.forEach(pos => {
        const group = new THREE.Group();
        group.position.copy(pos);
        const dirVec = this._forward.clone().multiplyScalar(isHead ? 1 : -1);
        dirVec.y = isHead ? -0.15 : -0.12; // 光照稍微朝下
        dirVec.normalize();

        // 灯光特效=物理光照：SpotLight 向外投射照亮地面（配合灯体 emissive+bloom 泛光）
        // 不再叠加任何 sprite/贴图光晕——此前多版叠加光效是"假光"的根源
        if (c.spotlight) {
          const sl = new THREE.SpotLight(new THREE.Color(color), isHead ? 18 : 7, 14, Math.PI / 5, 0.85, 1.6);
          const target = new THREE.Object3D();
          target.position.copy(dirVec.clone().multiplyScalar(5));
          group.add(sl); group.add(target);
          sl.target = target;
        }

        this._scene.add(group);
        this._lampEffects.push({ group, isHead });
      });
    }

    // 中国车牌纹理（蓝底白字 / 绿底黑字）
    _makePlateTexture(num, green) {
      const cv = document.createElement('canvas'); cv.width = 440; cv.height = 140;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 140);
      if (green) { g.addColorStop(0, '#25a95c'); g.addColorStop(1, '#1c8a4a'); }
      else { g.addColorStop(0, '#2a5cb8'); g.addColorStop(1, '#1d4295'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, 440, 140);
      ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 5;
      ctx.strokeRect(6, 6, 428, 128);
      ctx.fillStyle = green ? '#111111' : '#ffffff';
      ctx.font = 'bold 64px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(num, 220, 76);
      return cv;
    }

    _buildPlates() {
      const THREE = this.THREE, c = this._config;
      const num = String(c.plate_number || '').trim();
      if (!num || !this._forward) return;
      const green = c.plate_type === 'green';
      const cv = this._makePlateTexture(num, green);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;

      const fR = this._projRange(this._carBox, this._forward);
      const wR = this._projRange(this._carBox, this._widthAxis);
      const center = this._carBox.getCenter(new THREE.Vector3());
      const carW = wR.hi - wR.lo;
      const carH = this._carBox.max.y - this._groundY;
      const w = Math.max(0.3, carW * 0.24), h = w * (140 / 440);

      const mkPlate = (sign) => {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
        );
        let dist = (sign > 0 ? fR.hi : -fR.lo) + 0.004;
        // 后牌：整盒最后端在备胎后方（会悬空），按 front 比例缩进到保险杠面
        if (sign < 0) dist = dist * toNum((c.plate_rear || {}).front, 0.92) + 0.012; // 缩进到保险杠面再外贴 12mm，避免共面被遮挡
        const pos = center.clone().add(this._forward.clone().multiplyScalar(sign * dist));
        let hRatio = toNum(c.plate_height, 0.30);
        if (sign < 0) {
          // 后牌：保险杠左下牌照位（side 正=从车后看往左）
          const rear = c.plate_rear || {};
          pos.add(this._widthAxis.clone().multiplyScalar(toNum(rear.side, 0.52) * carW / 2));
          hRatio = toNum(rear.height, hRatio);
        }
        pos.y = this._groundY + carH * hRatio;
        mesh.position.copy(pos);
        mesh.lookAt(pos.clone().add(this._forward.clone().multiplyScalar(sign)));
        if (sign < 0) {
          // 后牌微旋：绕竖轴倾斜（正=从车后看右缘向外，贴合侧开尾门牌照座角度）
          const tilt = toNum((c.plate_rear || {}).tilt, 0);
          if (tilt) mesh.rotateY(-THREE.MathUtils.degToRad(tilt));
        }
        mesh.renderOrder = 3;
        this._scene.add(mesh);
        return mesh;
      };
      this._plateMeshes = [mkPlate(1), mkPlate(-1)]; // 前牌/后牌（并纳入点击检测范围）
    }

    _onResize() {
      if (!this._renderer || !this._wrap || !this._camera) return;
      const w = this._wrap.clientWidth, h = this._wrap.clientHeight;
      if (!w || !h) return;
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(w, h);
      if (this._composer) this._composer.setSize(w, h);
    }

    _doorOpenState(part) {
      const c = this._config;
      const ents = (c.door_entities && typeof c.door_entities === 'object') ? c.door_entities : {};
      // 兼容短键名（lf/rf/lr/rr/trunk）与长键名（lf_door/...）
      const ent = ents[part] || ents[part.replace('_door', '')];
      if (ent) {
        const s = readState(this._hass, ent);
        if (s != null) return isTruthy(s);
      }
      if (c.door_lock_entity) {
        const s = readState(this._hass, c.door_lock_entity);
        if (s != null) return isTruthy(s);
      }
      return false;
    }
    _windowOpenState() {
      const c = this._config;
      if (!c.window_entity) return false;
      return isTruthy(readState(this._hass, c.window_entity));
    }
    _rotateStateEff() {
      const c = this._config;
      if (c.auto_rotate_entity) {
        const s = readState(this._hass, c.auto_rotate_entity);
        if (s != null) return isTruthy(s);
      }
      return !!c.auto_rotate;
    }
    _lightsEff() {
      const c = this._config;
      let head = false, tail = false;
      if (c.headlight_entity) {
        const s = readState(this._hass, c.headlight_entity);
        if (s != null) head = isTruthy(s);
      } else if (c.light_entity) {
        head = isTruthy(readState(this._hass, c.light_entity));
      }
      if (c.taillight_entity) {
        const s = readState(this._hass, c.taillight_entity);
        if (s != null) tail = isTruthy(s);
      } else if (c.light_entity) {
        tail = isTruthy(readState(this._hass, c.light_entity));
      }
      return { head, tail };
    }

    _applyState() {
      if (!this._loaded || !this._hass) return;
      const T = this.THREE, c = this._config;
      if (!T) return;
      const da = T.MathUtils.degToRad(c.door_angle);
      const ta = T.MathUtils.degToRad(c.trunk_angle);
      this._doors.forEach(d => {
        const ang = d.part === 'trunk' ? ta : da;
        d.target = this._doorOpenState(d.part) ? d.dir * ang : 0;
      });
      this._winOpenTgt = this._windowOpenState() ? 1 : 0;

      let rot = this._rotateStateEff();
      if (this._topView) rot = false; // 俯视角度下不旋转
      if (this._controls) {
        this._controls.autoRotate = !!rot;
        this._controls.autoRotateSpeed = toNum(c.rotate_speed, 1.0);
      }
      if (this._rotateBtn) {
        this._rotateBtn.textContent = rot ? '自转 开' : '自转 关';
        this._rotateBtn.style.background = rot ? 'rgba(40,130,255,.75)' : 'rgba(20,60,120,.55)';
        this._rotateBtn.style.borderColor = rot ? '#7ab8ff' : '#4a8bff';
      }

      // 胎压 + 温度（左下 HUD 与俯视轮毂标签共用数据）
      const tpms = c.tpms || {};
      const tempCfg = tpms.temp || {};
      ['lf', 'rf', 'lr', 'rr'].forEach(pos => {
        const ent = tpms[pos];
        let v = '--';
        if (ent) {
          const raw = readState(this._hass, ent);
          if (raw != null) v = toNum(raw, 0).toFixed(2);
        }
        const el = this.shadowRoot && this.shadowRoot.querySelector('[data-k="tpms-' + pos + '"]');
        if (el) el.textContent = v + (v !== '--' && ent ? ' ' + (tpms.unit || '') : '');
        // 温度
        let tv = '';
        const tent = tempCfg[pos];
        if (tent) {
          let r = readState(this._hass, tent);
          if (r == null) r = readAttr(this._hass, tent, 'temperature');
          const n = toNum(r, NaN);
          if (!isNaN(n)) tv = n.toFixed(0) + '°C';
        }
        const te = this.shadowRoot && this.shadowRoot.querySelector('[data-k="wtemp-' + pos + '"]');
        if (te) te.textContent = tv;
        const pe = this.shadowRoot && this.shadowRoot.querySelector('[data-k="wp-' + pos + '"]');
        if (pe) pe.textContent = v === '--' ? '--' : v + ' ' + (tpms.unit || 'bar');
      });
      // 油量
      const fb = this.shadowRoot && this.shadowRoot.querySelector('[data-k="fuel-bar"]');
      const ft = this.shadowRoot && this.shadowRoot.querySelector('[data-k="fuel-text"]');
      if (c.fuel_entity) {
        const raw = readState(this._hass, c.fuel_entity);
        let pct = toNum(raw, null);
        if (pct == null) pct = toNum(readAttr(this._hass, c.fuel_entity, 'battery_level'), null);
        if (pct == null) pct = toNum(readAttr(this._hass, c.fuel_entity, 'level'), null);
        if (pct != null) {
          if (pct > 1) pct = Math.min(100, pct); else pct = pct * 100;
          if (fb) fb.style.width = pct.toFixed(0) + '%';
          if (ft) ft.textContent = pct.toFixed(0) + '%';
        } else {
          if (fb) fb.style.width = '0%';
          if (ft) ft.textContent = raw != null ? String(raw) : '--';
        }
      } else {
        if (fb) fb.style.width = '0%';
        if (ft) ft.textContent = '--';
      }
    }

    _animate() {
      this._raf = requestAnimationFrame(() => this._animate());
      const T = this.THREE;
      if (!T || !this._renderer) return;
      // 车门：绕世界垂直轴（pivot.rotation.y）
      this._doors.forEach(d => {
        d.current += (d.target - d.current) * 0.1;
        d.pivot.rotation.y = d.current;
      });
      // 车窗透明
      const tgtWin = this._winOpenTgt || 0;
      this._winCur = this._winCur == null ? 0 : this._winCur;
      this._winCur += (tgtWin - this._winCur) * 0.15;
      const winOpacity = 1 - this._winCur * 0.95;
      this._windows.forEach(w => {
        // 窗开关只作用于门玻璃；前挡/固定玻璃保持恒定
        const base = w.base || 0.35;
        const op = w.type === 'door' ? (0.05 + winOpacity * (base - 0.05)) : base;
        w.saved.forEach(s => {
          if (!s.m) return;
          try { s.m.opacity = op; s.m.transparent = true; } catch (e) {}
        });
      });
      // 车灯：自发光 + 特效可见性
      const { head, tail } = this._lightsEff();
      if (!this._lightColor) this._lightColor = new T.Color(this._config.light_color);
      if (!this._tailLightColor) this._tailLightColor = new T.Color(0xff2a1a);
      const applyL = (arr, on, color, intensity) => {
        arr.forEach(L => {
          L.saved.forEach(s => {
            if (!s.m || !s.m.emissive) return;
            if (on) {
              s.m.emissive.copy(color);
              s.m.emissiveIntensity = intensity;
              s.m.toneMapped = false;
            } else {
              s.m.emissive.copy(s.e);
              s.m.emissiveIntensity = s.ei;
              s.m.toneMapped = s.tm;
            }
          });
        });
      };
      applyL(this._headLights, head, this._lightColor, 7.0);
      applyL(this._tailLights, tail, this._tailLightColor, 9.0);
      this._lampEffects.forEach(fx => { fx.group.visible = fx.isHead ? head : tail; });

      // 车轮自转（可选）
      if (this._config.wheel_spin && this._wheels.length) {
        const sp = toNum(this._config.rotate_speed, 1.0);
        this._wheels.forEach(w => { w.rotation.x += 0.05 * Math.max(0.1, sp); });
      }

      // 相机过渡动画（进入/退出俯视）
      if (this._camTween) {
        const tw = this._camTween;
        tw.t += 16.7;
        let k = Math.min(1, tw.t / tw.dur);
        k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
        this._camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
        this._controls.target.lerpVectors(tw.fromTgt, tw.toTgt, k);
        if (k >= 1) this._camTween = null;
      }

      if (this._controls) this._controls.update();
      // 俯视时强制停转（含自转实体开启的情况）
      if (this._topView && this._controls && this._controls.autoRotate) this._controls.autoRotate = false;
      // 俯视时轮毂标签跟随投影（水平方向外推到车外，不遮挡车身）
      if (this._topView && this._wheelWorld && this._wheelTags) {
        const w = this._wrap.clientWidth, h = this._wrap.clientHeight;
        const pv = new T.Vector3();
        // 俯视下屏幕水平轴对应的世界向量（向右）
        const right = new T.Vector3().crossVectors(this._camera.up, this._camera.getWorldDirection(new T.Vector3())).normalize().negate();
        ['lf', 'rf', 'lr', 'rr'].forEach(kk => {
          const el = this._wheelTags[kk];
          const wp = this._wheelWorld[kk];
          if (!el || !wp) return;
          // 沿世界宽轴外推到车宽外
          const side = wp.dot(this._widthAxis) >= 0 ? 1 : -1;
          const wR = this._projRange(this._carBox, this._widthAxis);
          const halfW = (wR.hi - wR.lo) / 2;
          const out = wp.clone().addScaledVector(this._widthAxis, side * halfW * 0.35);
          pv.copy(out).project(this._camera);
          el.style.left = ((pv.x * 0.5 + 0.5) * w) + 'px';
          el.style.top = ((-pv.y * 0.5 + 0.5) * h) + 'px';
          // 屏幕左侧位置→translate(-105%)，右侧→translate(5%)，彻底出车外
          const onLeft = pv.x < 0;
          el.style.transform = 'translate(' + (onLeft ? '-108%' : '8%') + ',-50%)';
        });
      }
      if (this._composer) this._composer.render();
      else this._renderer.render(this._scene, this._camera);
    }

    disconnectedCallback() { this._cleanup(); }
  }

  if (!customElements.get('car-3d-card')) customElements.define('car-3d-card', Car3DCard);
  window.customCards = (window.customCards || []).concat([{
    type: 'car-3d-card', name: '3D 汽车', description: '3D 汽车展示卡片：5门开关、车灯泛光、车牌、车窗、胎压油量HUD、自转、点击俯视'
  }]);

  // ===== 可视化配置编辑器（Lovelace UI 配置模式）=====
  class Car3DEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._config = {};
    }
    setConfig(config) { this._config = config || {}; this._render(); }
    get value() { return this._config; }
    set value(v) { this._config = v || {}; this._render(); }
    _ch(patch) {
      this._config = Object.assign({}, this._config, patch);
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
      this._render();
    }
    _render() {
      const c = this._config || {};
      const inp = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--divider-color,#444);background:var(--card-background-color,#222);color:var(--primary-text-color,#fff);font-size:13px;';
      const row = (label, inner) =>
        '<div style="margin:10px 0"><div style="font-size:12px;color:var(--secondary-text-color,#888);margin-bottom:3px">' + label + '</div>' + inner + '</div>';
      this.shadowRoot.innerHTML =
        '<div style="padding:4px 12px 12px">' +
        row('标题', '<input id="e-title" style="' + inp + '" value="' + (c.title || '') + '" placeholder="可选">') +
        row('车牌号', '<input id="e-plate" style="' + inp + '" value="' + (c.plate_number || '') + '" placeholder="如 甘M·DM815">') +
        row('车牌颜色', '<select id="e-ptype" style="' + inp + '"><option value="blue"' + (c.plate_type !== 'green' ? ' selected' : '') + '>蓝色（燃油车）</option><option value="green"' + (c.plate_type === 'green' ? ' selected' : '') + '>绿色（新能源）</option></select>') +
        row('背景颜色', '<input id="e-bg" type="color" style="' + inp + 'height:36px" value="' + (c.bg_color || '#0e0e0e') + '">') +
        row('默认自动旋转', '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--primary-text-color,#fff)"><input id="e-ar" type="checkbox" style="width:18px;height:18px"' + (c.auto_rotate ? ' checked' : '') + '>开启后进入卡片即自动旋转（点击车身进入俯视时暂停）</label>') +
        row('旋转速度', '<input id="e-rs" type="number" step="0.1" min="0.1" style="' + inp + '" value="' + (c.rotate_speed != null ? c.rotate_speed : 1) + '">') +
        row('卡片高度（px）', '<input id="e-ht" type="number" step="10" min="200" style="' + inp + '" value="' + (c.height != null ? c.height : 400) + '">') +
        '<div style="font-size:11px;color:var(--secondary-text-color,#888);margin-top:12px;line-height:1.5">提示：门/灯/车窗/胎压/油量等实体绑定请点击右下角"显示代码编辑器"切换 YAML 模式配置。点击 3D 车身可切换俯视视角（车头朝上，轮毂处显示胎压温度）。</div>' +
        '</div>';
      const $ = id => this.shadowRoot.getElementById(id);
      $('e-title').onchange = e => this._ch({ title: e.target.value });
      $('e-plate').onchange = e => this._ch({ plate_number: e.target.value });
      $('e-ptype').onchange = e => this._ch({ plate_type: e.target.value });
      $('e-bg').oninput = e => this._ch({ bg_color: e.target.value });
      $('e-ar').onchange = e => this._ch({ auto_rotate: e.target.checked });
      $('e-rs').onchange = e => this._ch({ rotate_speed: parseFloat(e.target.value) || 1 });
      $('e-ht').onchange = e => this._ch({ height: parseInt(e.target.value) || 400 });
    }
  }
  if (!customElements.get('car-3d-card-editor')) customElements.define('car-3d-card-editor', Car3DEditor);
})();
