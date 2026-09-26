"""GLSL shaders.

Each scene is a fragment shader that draws one "oscillator" pattern.
The post shader mixes scenes, adds video feedback, camera input and
analog-style effects (RGB shift, glitch, scanlines).
"""

VERTEX = """
#version 330
out vec2 v_uv;
void main() {
    // Fullscreen triangle generated from gl_VertexID (no vertex buffer needed).
    vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    v_uv = pos;
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
"""

SCENE_HEADER = """
#version 330
uniform float u_time;        // phase time (already multiplied by speed)
uniform vec2  u_res;
uniform float u_hue;
uniform float u_sat;
uniform float u_zoom;
uniform float u_warp;
uniform float u_complexity;
uniform vec3  u_audio;       // bass, mid, high (0..~1)
in vec2 v_uv;
out vec4 f_color;

#define PI  3.14159265
#define TAU 6.28318531

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
}

// Cosine palette, rotated by u_hue and scaled by u_sat.
vec3 palette(float t) {
    vec3 c = 0.5 + 0.5 * cos(TAU * (t + u_hue + vec3(0.0, 0.33, 0.67)));
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(l), c, u_sat), 0.0);
}

// Aspect-correct coordinates centred on the screen.
vec2 centered() {
    vec2 p = (v_uv - 0.5) * u_res / min(u_res.x, u_res.y);
    return p / u_zoom;
}
"""

SCENES = {
    "plasma": """
void main() {
    vec2 p = centered();
    float t = u_time;
    p += u_warp * 0.3 * vec2(sin(p.y * 3.0 + t), cos(p.x * 3.0 - t));
    float k = u_complexity;
    float v = sin(p.x * 4.0 * k + t)
            + sin(p.y * 5.0 * k - t * 1.3)
            + sin((p.x + p.y) * 3.0 * k + t * 0.7)
            + sin(length(p) * 8.0 * k - t * 2.0 - u_audio.x * 4.0);
    vec3 c = palette(v * 0.125 + t * 0.05);
    c *= 0.7 + 0.6 * u_audio.x;
    f_color = vec4(c, 1.0);
}
""",
    "tunnel": """
void main() {
    vec2 p = centered();
    float t = u_time;
    float r = length(p) + 1e-4;
    float a = atan(p.y, p.x) / PI;
    float z = 0.4 / r + t;
    a += 0.1 * t + u_warp * 0.15 * sin(z * 2.0);
    float segs = floor(4.0 + u_complexity * 6.0);
    float ch = mod(floor(z * 4.0) + floor(a * segs), 2.0);
    float edge = smoothstep(0.0, 0.08, abs(fract(z * 4.0) - 0.5));
    vec3 c = palette(z * 0.1 + ch * 0.25) * (0.25 + 0.75 * ch) * (0.5 + 0.5 * edge);
    c += palette(z * 0.1 + 0.5) * (1.0 - edge) * (0.5 + u_audio.z * 2.0);
    c *= smoothstep(0.0, 0.6, r) * (1.0 + u_audio.x);
    f_color = vec4(c, 1.0);
}
""",
    "kaleido": """
void main() {
    vec2 p = centered();
    float t = u_time;
    float n = floor(3.0 + u_complexity * 5.0);
    float r = length(p);
    float a = atan(p.y, p.x) + t * 0.05;
    a = mod(a, TAU / n);
    a = abs(a - PI / n);
    p = r * vec2(cos(a), sin(a));
    p = p * 2.5 + vec2(t * 0.15, 0.0);
    vec2 w = vec2(fbm(p + t * 0.2), fbm(p - t * 0.2 + 3.7));
    float f = fbm(p * 1.5 + u_warp * 2.0 * w);
    vec3 c = palette(f * 1.5 + r * 0.3 - t * 0.05);
    c *= smoothstep(0.25, 0.75, f) * 1.6 + u_audio.y * 0.6;
    f_color = vec4(c, 1.0);
}
""",
    "lines": """
// Rutt-Etra / oscilloscope style raster lines.
void main() {
    vec2 uv = v_uv;
    float t = u_time;
    vec3 c = vec3(0.0);
    const int N = 24;
    for (int i = 0; i < N; i++) {
        float fi = float(i) / float(N);
        float base = (fi - 0.5) / u_zoom + 0.5;
        float disp = 0.05 * sin(uv.x * (6.0 + fi * 10.0) * u_complexity + t * (1.0 + fi))
                   + 0.08 * u_warp * (fbm(vec2(uv.x * 3.0 + t * 0.3, fi * 7.0)) - 0.5)
                   + 0.06 * u_audio.x * sin(uv.x * 30.0 + t * 4.0);
        float d = abs(uv.y - base - disp);
        c += palette(fi + t * 0.03) * 0.0025 / (d + 0.0015);
    }
    c *= 0.6 + 0.8 * u_audio.y;
    f_color = vec4(c, 1.0);
}
""",
    "rings": """
// Moire of two moving ring oscillators.
void main() {
    vec2 p = centered();
    float t = u_time;
    vec2 c1 = 0.35 * vec2(sin(t * 0.7), cos(t * 0.5));
    vec2 c2 = -c1 * (1.0 + u_warp);
    float k = 40.0 * u_complexity;
    float f = sin(length(p - c1) * k - t * 3.0) * sin(length(p - c2) * k + t * 2.0);
    vec3 col = palette(f * 0.2 + length(p) * 0.3 + t * 0.02);
    col *= smoothstep(-0.3, 0.8, f + u_audio.x * 0.8);
    f_color = vec4(col, 1.0);
}
""",
    "flow": """
// Domain-warped noise: slow organic liquid.
void main() {
    vec2 p = centered() * 2.0;
    float t = u_time * 0.5;
    vec2 q = vec2(fbm(p + t * 0.3), fbm(p + vec2(5.2, 1.3) - t * 0.3));
    vec2 r = vec2(fbm(p + 4.0 * u_warp * q + vec2(1.7, 9.2) + t * 0.2),
                  fbm(p + 4.0 * u_warp * q + vec2(8.3, 2.8) - t * 0.2));
    float f = fbm(p * u_complexity + 3.0 * r);
    vec3 col = palette(f * 1.2 + length(q) * 0.5);
    col *= f * f * 2.5 + 0.15 + u_audio.x * 0.5;
    f_color = vec4(col, 1.0);
}
""",
}

SCENE_NAMES = list(SCENES.keys())

POST = """
#version 330
uniform sampler2D u_scene_a;   // current scene
uniform sampler2D u_scene_b;   // previous scene (during crossfade)
uniform sampler2D u_prev;      // last output frame (video feedback)
uniform sampler2D u_cam;       // camera / input video
uniform float u_mix;           // 1 = only scene A
uniform float u_feedback;
uniform float u_fb_zoom;
uniform float u_fb_rot;
uniform float u_rgb;
uniform float u_glitch;
uniform float u_bright;
uniform float u_strobe;
uniform int   u_invert;
uniform int   u_mirror;
uniform int   u_cam_mode;      // 0 off, 1 screen blend, 2 luma key, 3 displace
uniform float u_cam_amt;
uniform float u_cam_key;
uniform float u_clock;         // real time, for glitch timing
in vec2 v_uv;
out vec4 f_color;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 scene(vec2 uv) {
    vec3 a = texture(u_scene_a, uv).rgb;
    if (u_mix >= 1.0) return a;
    return mix(texture(u_scene_b, uv).rgb, a, u_mix);
}

void main() {
    vec2 uv = v_uv;
    if (u_mirror == 1) uv.x = 0.5 - abs(uv.x - 0.5);
    if (u_mirror == 2) uv = 0.5 - abs(uv - 0.5);

    // Horizontal block glitch.
    float tick = floor(u_clock * 12.0);
    float row = floor(uv.y * 24.0);
    float h = hash(vec2(row, tick));
    if (h < u_glitch * 0.35) uv.x += (hash(vec2(tick, row)) - 0.5) * u_glitch * 0.3;

    vec3 cam = texture(u_cam, vec2(v_uv.x, 1.0 - v_uv.y)).rgb;
    if (u_cam_mode == 3) uv += (luma(cam) - 0.5) * u_cam_amt * 0.15;

    // Chromatic aberration.
    vec2 off = vec2(u_rgb * 0.012, 0.0);
    vec3 col = vec3(scene(uv + off).r, scene(uv).g, scene(uv - off).b);

    if (u_cam_mode == 1) col = 1.0 - (1.0 - col) * (1.0 - cam * u_cam_amt);
    if (u_cam_mode == 2) {
        float k = smoothstep(u_cam_key, u_cam_key + 0.08, luma(cam));
        col = mix(col, cam, k * u_cam_amt);
    }

    // Video feedback: previous frame, zoomed and rotated around the centre.
    vec2 c = v_uv - 0.5;
    float s = sin(u_fb_rot), co = cos(u_fb_rot);
    c = mat2(co, -s, s, co) * c / u_fb_zoom;
    vec3 prev = texture(u_prev, c + 0.5).rgb;
    col = max(col, prev * u_feedback);

    col *= u_bright;
    if (u_invert == 1) col = 1.0 - clamp(col, 0.0, 1.0);
    col = mix(col, vec3(1.0) - col * 0.5, u_strobe);

    // Scanlines/vignette are applied in DISPLAY so they don't accumulate
    // in the feedback loop.
    f_color = vec4(col, 1.0);
}
"""

DISPLAY = """
#version 330
uniform sampler2D u_tex;
uniform float u_scan;
uniform vec2  u_res;
in vec2 v_uv;
out vec4 f_color;
void main() {
    vec3 col = texture(u_tex, v_uv).rgb;
    float line = 0.5 + 0.5 * sin(v_uv.y * u_res.y * PI_OVER_2);
    col *= 1.0 - u_scan * 0.6 * line;
    vec2 d = v_uv - 0.5;
    col *= 1.0 - u_scan * 0.8 * dot(d, d);
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
""".replace("PI_OVER_2", "1.5707963")
