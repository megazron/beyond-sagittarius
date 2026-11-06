import * as THREE from 'three';

/**
 * Contact-hardening sun shadows for Ultra and Cinematic. Works on three's Basic
 * shadow maps, whose raw depth PCSS needs: a blocker search estimates how far
 * the caster is from the receiver, and the filter radius grows with that gap,
 * so a shadow is sharp at the trunk and soft at the end of its length.
 */
let done = false;

const PCSS = /* glsl */ `
	float pcssIgn( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
	vec2 pcssDisk( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float t = float( i ) * 2.399963 + phi;
		return vec2( cos( t ), sin( t ) ) * r;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		if ( shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 || shadowCoord.y > 1.0 || shadowCoord.z > 1.0 ) return 1.0;
		vec2 texel = 1.0 / shadowMapSize;
		float phi = pcssIgn( gl_FragCoord.xy ) * 6.2831853;
		float zr = shadowCoord.z;
		float sum = 0.0, cnt = 0.0;
		for ( int i = 0; i < 10; i ++ ) {
			float d = texture2D( shadowMap, shadowCoord.xy + pcssDisk( i, 10, phi ) * texel * shadowRadius * 6.0 ).r;
			if ( d < zr ) { sum += d; cnt += 1.0; }
		}
		if ( cnt < 0.5 ) return 1.0;
		float gap = ( zr - sum / cnt );
		float radius = clamp( gap * 1400.0, 0.9, shadowRadius * 7.0 );
		float lit = 0.0;
		for ( int i = 0; i < 18; i ++ ) {
			float d = texture2D( shadowMap, shadowCoord.xy + pcssDisk( i, 18, phi ) * texel * radius ).r;
			lit += step( zr, d );
		}
		return mix( 1.0, lit / 18.0, shadowIntensity );
	}
`;

export function installSoftShadows() {
  if (done) return;
  done = true;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = src.indexOf('#else // SHADOWMAP_TYPE_BASIC');
  const b = src.indexOf('#endif', src.indexOf('return mix( 1.0, shadow, shadowIntensity );', a));
  if (a < 0 || b < 0) { console.warn('[shadows] three chunk changed; PCSS not installed'); return; }
  THREE.ShaderChunk.shadowmap_pars_fragment = `${src.slice(0, a)}#else // SHADOWMAP_TYPE_BASIC\n${PCSS}\n${src.slice(b)}`;
}
