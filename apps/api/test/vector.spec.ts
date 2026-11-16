import { serializeVector } from '../src/database/vector-sql';

describe('vector boundary', () => {
  it('accepts a nonzero fixed-dimension vector and rounds to float32', () => {
    const vector = Array<number>(1536).fill(0);
    vector[0] = 0.1;
    const serialized = JSON.parse(serializeVector(vector)) as number[];
    expect(serialized).toHaveLength(1536);
    expect(serialized[0]).toBe(Math.fround(0.1));
  });

  it.each(
    [
      [],
      Array<number>(1535).fill(1),
      Array<number>(1537).fill(1),
      Array<number>(1536).fill(0),
      Array<number>(1536).fill(NaN),
      Array<number>(1536).fill(Infinity),
      Array<number>(1536).fill(1e100),
      Array<number>(1536).fill(1e-100),
    ].map((vector) => [vector]),
  )(
    'rejects incompatible/invalid vectors without echoing their contents',
    (vector) => {
      expect(() => serializeVector(vector)).toThrow(/vector|Vector/);
    },
  );
});
