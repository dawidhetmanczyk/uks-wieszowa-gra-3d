import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  DT,
  launchVelocity,
  NET_CLEARANCE,
  NET_HEIGHT,
  predictLanding,
  solveArc,
  solveShot,
  stepBall,
  type Vec3,
} from '../../src/sim';
import { launchBallTo, makeState, ofType, run } from './pomocnicze';

function fly(from: Vec3, vel: Vec3, steps: number): Vec3 {
  const p = { ...from };
  const v = { ...vel };
  for (let i = 0; i < steps; i++) stepBall(p, v);
  return p;
}

describe('balistyka', () => {
  it('launchVelocity trafia w cel po T krokach stepBall (1e-6)', () => {
    const cases: [Vec3, Vec3, number][] = [
      [{ x: -2, y: 1.2, z: -6 }, { x: 1, y: BALL_R, z: 5 }, 240],
      [{ x: 3, y: 2.5, z: -1 }, { x: -3, y: 0.5, z: 7 }, 90],
      [{ x: 0, y: 0.3, z: 8 }, { x: 0, y: 3.0, z: -8 }, 400],
    ];
    for (const [from, to, steps] of cases) {
      const v = launchVelocity(from, to, steps * DT);
      const p = fly(from, v, steps);
      expect(Math.abs(p.x - to.x)).toBeLessThan(1e-6);
      expect(Math.abs(p.y - to.y)).toBeLessThan(1e-6);
      expect(Math.abs(p.z - to.z)).toBeLessThan(1e-6);
    }
  });

  it('predictLanding zgadza się z faktycznym torem w sim co do ticku', () => {
    for (const seed of [1, 2, 3]) {
      const state = makeState(seed);
      // Piłka daleko od zawodników, żeby nikt jej nie dotknął po drodze.
      launchBallTo(
        state,
        { x: -5.5, y: 1.5, z: 3 },
        { x: -5.8, z: -3 + seed * 0.5 },
        1.3 + seed * 0.1,
        {
          lastToucher: 2,
        },
      );
      // Stan po ustawieniu piłki nie ma jeszcze predykcji – liczymy jak sim, z nowTick = tick.
      const first = predictLanding(state.ball.pos, state.ball.vel, state.tick);
      expect(first.valid).toBe(true);
      expect(first.hitsNet).toBe(false);
      const predictedTicks = new Set<number>();
      const events = run(state, 600, undefined, (s) => {
        // Po punkcie piłka odbija się od podłogi i predykcja liczy kolejne lądowania – pomijamy.
        if (s.rally.phase === 'rally' && s.landing.valid) predictedTicks.add(s.landing.tick);
      });
      const floor = ofType(events, 'floor');
      expect(floor.length).toBe(1);
      // Predykcja sprzed kroku liczy od stanu sprzed pierwszego stepBall, więc jest o 1 tick
      // „starsza” niż predykcja liczona w kroku (po stepBall tego ticku) – stąd −1.
      expect(floor[0]!.tick).toBe(first.tick - 1);
      // Predykcja w trakcie lotu jest stała (ten sam krok całkowania) i równa tickowi
      // kroku, w którym sim zgłasza `floor`.
      expect(predictedTicks.size).toBe(1);
      expect([...predictedTicks][0]).toBe(floor[0]!.tick);
    }
  });

  it('solveShot przechodzi nad siatką z zapasem', () => {
    const shots: [Vec3, Vec3, number][] = [
      [{ x: 0, y: 2.3, z: -5 }, { x: 0, y: BALL_R, z: 4 }, 15],
      [{ x: 2, y: 1.0, z: -8 }, { x: -3, y: BALL_R, z: 6 }, 11],
      [{ x: -1, y: 2.6, z: -1.2 }, { x: 1, y: BALL_R, z: 3 }, 19],
    ];
    for (const [from, to, speed] of shots) {
      const v = solveShot(from, to, speed);
      const p = { ...from };
      const vel = { ...v };
      let crossedY = -1;
      for (let i = 0; i < 1200 && crossedY < 0; i++) {
        const prevZ = p.z;
        stepBall(p, vel);
        if (Math.sign(p.z) !== Math.sign(prevZ)) crossedY = p.y;
      }
      expect(crossedY).toBeGreaterThan(0);
      // Tolerancja jednego kroku: kontrakt sprawdza prześwit analitycznie w chwili przecięcia.
      expect(crossedY - BALL_R).toBeGreaterThanOrEqual(NET_HEIGHT + NET_CLEARANCE - 0.02);
    }
  });

  it('solveArc ląduje w celu ±2 cm', () => {
    const arcs: [Vec3, Vec3, number][] = [
      [{ x: -2.25, y: 1.2, z: -6 }, { x: 2.0, y: BALL_R, z: -2.2 }, 3.4],
      [{ x: 2.25, y: 2.0, z: -2.2 }, { x: -2.0, y: BALL_R, z: -1.1 }, 3.0],
      [{ x: 0, y: 0.8, z: 7 }, { x: 1.5, y: BALL_R, z: 2.2 }, 3.4],
    ];
    for (const [from, to, apex] of arcs) {
      const v = solveArc(from, to, apex);
      const p = { ...from };
      const vel = { ...v };
      let prev: Vec3;
      let landed: Vec3 | null = null;
      for (let i = 0; i < 1200 && !landed; i++) {
        prev = { ...p };
        stepBall(p, vel);
        if (p.y - BALL_R <= 0) {
          // Interpolacja do chwili dotknięcia – tak samo ocenia to sim.
          const f = (prev.y - BALL_R) / (prev.y - p.y);
          landed = { x: prev.x + (p.x - prev.x) * f, y: BALL_R, z: prev.z + (p.z - prev.z) * f };
        }
      }
      expect(landed).not.toBeNull();
      expect(Math.abs(landed!.x - to.x)).toBeLessThan(0.02);
      expect(Math.abs(landed!.z - to.z)).toBeLessThan(0.02);
    }
  });
});
