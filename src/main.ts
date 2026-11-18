import * as THREE from 'three';

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Scene & atmosphere ---------------------------------------------------
const scene = new THREE.Scene();

// Dusty, hellish dusk: the background and the fog share the same color,
// so distant objects fade seamlessly into the sky.
const SKY_COLOR = 0x3a1810;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.Fog(SKY_COLOR, 5, 30); // starts at 5m, fully opaque at 30m

// --- Camera ---------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.7, 5); // eye height ~1.7m, 5m back from the origin
camera.lookAt(0, 0.5, 0);

// --- Lights ---------------------------------------------------------------
// Hemisphere light: soft ambient light, one color from above (sky) and one from below (ground).
const ambient = new THREE.HemisphereLight(0x8a4a30, 0x1a0d08, 0.6);
scene.add(ambient);

// Point light: a warm "lantern" that lights things around it and fades with distance.
const lantern = new THREE.PointLight(0xffa040, 25, 12); // color, intensity, range (m)
lantern.position.set(-1.5, 2.5, 1.5);
scene.add(lantern);

// --- Objects --------------------------------------------------------------
// A mesh = geometry (the shape) + material (how its surface reacts to light).
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 }), // dry dirt
);
floor.rotation.x = -Math.PI / 2; // planes are created vertical: lay it flat
scene.add(floor);

const crate = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }), // wood
);
crate.position.set(0, 0.5, 0); // box is centered on its origin: lift it by half its height
scene.add(crate);

// --- Resize ---------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop -----------------------------------------------------------------
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
