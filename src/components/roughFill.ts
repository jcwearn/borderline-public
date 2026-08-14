/**
 * The hatch that says a country is rough.
 *
 * An outline alone did not carry it. The rough is a property of the *ground*,
 * and ground is read by its texture — an outline reads as selection, which is
 * what it looked like: a thin gold edge sitting a shade away from the amber the
 * start endpoint already wears, so the marked region looked related to the
 * player's own end of the board rather than like terrain.
 *
 * Hatching solves the problem the colour could not. `Role` already owns the
 * fill — green for your route, blue for a legal move, pink and amber for the
 * two ends — and rough is true *alongside* a role rather than instead of one,
 * so it cannot have a fill of its own without hiding something the player needs
 * more. A pattern multiplied over whatever fill the role chose keeps both: the
 * shape stays the colour it should be, and it is visibly scored across.
 *
 * Two things were tried first and are worth recording, because both looked
 * right in the small and wrong on the globe.
 *
 * A repeating canvas texture came apart at the zoom a whole region is read
 * from: the pattern minifies far enough to reach its mipmaps, and a 45° stripe
 * averaged down beats against itself, so the stripes stayed but a second, finer
 * pattern of dots appeared between them. Computing the stripe per fragment has
 * no mipmaps to beat against, and `fwidth` keeps its edge one pixel wide at any
 * distance.
 *
 * Taking the pattern from the geometry's own UVs came apart on islands. Those
 * UVs are longitude and latitude scaled across each *shape's* bounding box, and
 * a country is drawn as one shape per polygon — so a frequency that suited the
 * Italian mainland hatched Sicily and Sardinia several times finer, and Italy
 * read as two different kinds of ground. Deriving latitude and longitude from
 * the vertex position instead makes the hatch a property of the map rather than
 * of the shape it happens to be drawn on, so every country matches every other
 * and a country matches itself.
 */
import * as THREE from 'three'

/**
 * How far apart the stripes run, in degrees — about 175 km.
 *
 * The one number worth turning. Much finer and a region reads as noise at the
 * zoom you see the whole of it from; much coarser and a small country gets two
 * stripes and looks like a rendering fault rather than a texture.
 */
const PERIOD_DEGREES = 1.6

/**
 * How much of each period is band rather than gap, from 0 to 1.
 *
 * A little under half, so the fill still reads as its own colour between the
 * bands — the role has to survive being hatched.
 */
const DUTY = 0.42

/**
 * What the hatch multiplies the role's colour by.
 *
 * Multiplication is the whole reason this works on every role at once: white
 * leaves a colour alone and anything darker takes it down, so the bands are
 * always the same fill a shade deeper and can never fight what the fill is
 * saying. Warm rather than neutral, so the darkening reads as earth and not as
 * shadow — but only a little, because a strong tint would drag mint and pink
 * towards the same brown and undo the point.
 */
const BAND = 'rgb(122, 84, 52)'

/**
 * Distinguishes the patched program from an ordinary basic material's.
 *
 * Without it three would look at two `MeshBasicMaterial`s, see the same
 * built-in shader, and hand this one the unpatched program off the cache.
 */
const PROGRAM_KEY = 'borderline-rough-hatch'

/**
 * Cached on the fill alone.
 *
 * Nothing about the hatch depends on which country it is drawn over any more —
 * that was the whole point of taking it off the UVs — so this is at most one
 * material per role, for the life of the page.
 */
const materials = new Map<string, THREE.MeshBasicMaterial>()

/** A cap material that draws `fill` hatched. */
export function roughMaterial(fill: string): THREE.MeshBasicMaterial {
  const known = materials.get(fill)
  if (known) return known

  const alpha = opacityOf(fill)
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(fill),
    transparent: alpha < 1,
    opacity: alpha,
  })

  material.customProgramCacheKey = () => PROGRAM_KEY
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHatchBand = { value: new THREE.Color(BAND) }
    shader.uniforms.uHatchPeriod = { value: (PERIOD_DEGREES * Math.PI) / 180 }
    shader.uniforms.uHatchDuty = { value: DUTY }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatchPos;')
      // The vertex sits on the globe at whatever radius the geometry was built
      // at, and the object is then scaled to lift it. Only the direction is
      // wanted, so neither matters.
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvHatchPos = normalize(position);',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vHatchPos;
         uniform vec3 uHatchBand;
         uniform float uHatchPeriod;
         uniform float uHatchDuty;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec3 hatchDir = normalize(vHatchPos);
           // three-globe places a point by phi = 90 - lat and theta = 90 - lng,
           // so this is that arithmetic run backwards.
           float hatchLat = asin(clamp(hatchDir.y, -1.0, 1.0));
           float hatchLng = radians(90.0) - atan(hatchDir.z, hatchDir.x);
           // Longitude converges towards the poles, so it is worth less ground
           // the further north a region sits. Without this the bands would
           // stretch sideways and stop being 45 degrees.
           float phase = (hatchLng * cos(hatchLat) + hatchLat) / uHatchPeriod;
           // Distance from the middle of a period, 0 at the centre of a band
           // and 1 at the centre of a gap. \`fwidth\` is how far that moves
           // between neighbouring pixels, which is exactly the width the edge
           // has to be soft over to stop it crawling.
           float wave = abs(fract(phase) - 0.5) * 2.0;
           float soft = max(fwidth(phase) * 2.0, 1e-4);
           float band = 1.0 - smoothstep(uHatchDuty - soft, uHatchDuty + soft, wave);
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uHatchBand, band);
         }`,
      )
  }

  materials.set(fill, material)
  return material
}

/** The alpha out of an `rgba(...)` fill, since the role table is written in them. */
function opacityOf(fill: string): number {
  const match = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/.exec(fill)
  return match ? Number(match[1]) : 1
}
