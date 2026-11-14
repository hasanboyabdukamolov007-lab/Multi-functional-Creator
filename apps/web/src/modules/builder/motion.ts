/**
 * Micro-interaction presets for builder elements. Stored as props._motion and rendered as a
 * data-motion attribute, so the same CSS works in the editor, previews and every export.
 * Entrance presets reveal on scroll via a tiny IntersectionObserver script; all honour reduced motion.
 */
export interface MotionPreset {
  id: string;
  label: string;
  group: "hover" | "press" | "enter" | "loop";
}

export const MOTION_PRESETS: MotionPreset[] = [
  { id: "hover-lift", label: "Lift on hover", group: "hover" },
  { id: "hover-grow", label: "Grow on hover", group: "hover" },
  { id: "hover-glow", label: "Glow on hover", group: "hover" },
  { id: "hover-tilt", label: "Tilt on hover", group: "hover" },
  { id: "hover-underline", label: "Underline sweep", group: "hover" },
  { id: "press-squish", label: "Squish on press", group: "press" },
  { id: "in-fade-up", label: "Fade up (scroll reveal)", group: "enter" },
  { id: "in-fade", label: "Fade in (scroll reveal)", group: "enter" },
  { id: "in-slide-left", label: "Slide from left", group: "enter" },
  { id: "in-slide-right", label: "Slide from right", group: "enter" },
  { id: "in-zoom", label: "Zoom in", group: "enter" },
  { id: "in-blur", label: "Blur in", group: "enter" },
  { id: "loop-float", label: "Float", group: "loop" },
  { id: "loop-pulse", label: "Pulse", group: "loop" },
  { id: "loop-spin", label: "Slow spin", group: "loop" },
  { id: "loop-shimmer", label: "Shimmer", group: "loop" },
  { id: "loop-wiggle", label: "Wiggle", group: "loop" },
];

export const MOTION_CSS = `
[data-motion] { --m-dur: .6s; --m-ease: cubic-bezier(.2,.8,.2,1); }
[data-motion^="hover-"], [data-motion="press-squish"] { transition: transform .22s var(--m-ease), box-shadow .22s var(--m-ease), filter .22s; }
[data-motion="hover-lift"]:hover { transform: translateY(-6px); box-shadow: 0 18px 40px -18px rgb(0 0 0 / .35); }
[data-motion="hover-grow"]:hover { transform: scale(1.04); }
[data-motion="hover-glow"]:hover { box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary, #6d5efc) 30%, transparent), 0 10px 30px -10px var(--color-primary, #6d5efc); }
[data-motion="hover-tilt"]:hover { transform: perspective(700px) rotateX(4deg) rotateY(-6deg); }
[data-motion="hover-underline"] { background-image: linear-gradient(currentColor, currentColor); background-size: 0% 2px; background-position: 0 100%; background-repeat: no-repeat; transition: background-size .3s var(--m-ease); }
[data-motion="hover-underline"]:hover { background-size: 100% 2px; }
[data-motion="press-squish"]:active { transform: scale(.95); }
.mfc-motion [data-motion^="in-"] { opacity: 0; }
.mfc-motion [data-motion^="in-"].mfc-in { animation: var(--m-name) var(--m-dur) var(--m-ease) both; }
[data-motion="in-fade-up"] { --m-name: m-fade-up; } [data-motion="in-fade"] { --m-name: m-fade; }
[data-motion="in-slide-left"] { --m-name: m-slide-left; } [data-motion="in-slide-right"] { --m-name: m-slide-right; }
[data-motion="in-zoom"] { --m-name: m-zoom; } [data-motion="in-blur"] { --m-name: m-blur; }
@keyframes m-fade-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }
@keyframes m-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes m-slide-left { from { opacity: 0; transform: translateX(-48px); } to { opacity: 1; transform: none; } }
@keyframes m-slide-right { from { opacity: 0; transform: translateX(48px); } to { opacity: 1; transform: none; } }
@keyframes m-zoom { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }
@keyframes m-blur { from { opacity: 0; filter: blur(12px); } to { opacity: 1; filter: none; } }
[data-motion="loop-float"] { animation: m-float 4s ease-in-out infinite; }
[data-motion="loop-pulse"] { animation: m-pulse 2.2s ease-in-out infinite; }
[data-motion="loop-spin"] { animation: m-spin 12s linear infinite; }
[data-motion="loop-wiggle"] { animation: m-wiggle 2.8s ease-in-out infinite; }
[data-motion="loop-shimmer"] { background-image: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / .45) 50%, transparent 70%); background-size: 250% 100%; animation: m-shimmer 2.4s linear infinite; }
@keyframes m-float { 50% { transform: translateY(-10px); } }
@keyframes m-pulse { 50% { transform: scale(1.05); } }
@keyframes m-spin { to { transform: rotate(360deg); } }
@keyframes m-wiggle { 0%, 70%, 100% { transform: none; } 80% { transform: rotate(-4deg); } 90% { transform: rotate(4deg); } }
@keyframes m-shimmer { from { background-position: 150% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { [data-motion] { animation: none !important; transition: none !important; } .mfc-motion [data-motion^="in-"] { opacity: 1; } }
`;

/** Scroll-reveal runtime for exported pages (≈400 bytes). */
export const MOTION_JS = `(function(){var d=document.documentElement;if(!("IntersectionObserver" in window)||matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.classList.add("mfc-motion");var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("mfc-in");io.unobserve(e.target);}})},{threshold:.15,rootMargin:"0px 0px -8% 0px"});document.querySelectorAll('[data-motion^="in-"]').forEach(function(el,i){el.style.animationDelay=(i%4)*80+"ms";io.observe(el)});})();`;

export const usesEntrance = (html: string) => /data-motion="in-/.test(html);
