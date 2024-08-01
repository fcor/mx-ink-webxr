varying vec2 vUv;
uniform float uTime;

// Random function from Lygia by Patricio Gonzalez Vivo
float random2d(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233)))*43758.5453123);
}

void main(){
    
    // vec2 uv = vUv;
        
    // gl_FragColor=vec4( abs(sin(cos(uTime+3.*uv.y)*2.*uv.x+uTime)),
    //     abs(cos(sin(uTime+2.*uv.x)*3.*uv.y+uTime)),
    //     uv.x * 100.,1.);
    vec2 p = -1.0 + 20.0 * vUv;

    float yOffset = 9.0;
    float xOffset = 9.5;
    float speed = 0.3;
    float brightness = 0.009;
    float perspective = 8.0;
    float colorOffset = 0.0;
    float t = uTime + 1200.0;
    
    p.x += xOffset;
    p.y += yOffset;
    vec2 uv = 1. * p;
    
    uv = speed*uTime + vec2((uv.y)/(uv.x) * perspective, uv.x);

    float val1 = random2d(floor(uv)) * t * brightness;
    float val2 = fract(random2d(floor(uv)) + t / 2.0);

    val1 *= fract(uv.y)/5.;
    val2 += colorOffset - length(fract(uv.xx))/4.;
    
    vec3 col = vec3(val1 * 2.0 , val2 * val2 * 4.0, val2 * 5.0);
    // gl_FragColor=vec4(vUv, 0.0, 1.0);
    gl_FragColor=vec4(col, 1.0);
}