// 像素放大镜标志：用字符图描述，每个字符一个像素
const MAP = [
  '....KKKKK.......',
  '..KKGGGGGKK.....',
  '.KGGMMMMMGGK....',
  '.KGMMWWMMMGK....',
  'KGMMWWMMMMMGK...',
  'KGMMWMMMMMMGK...',
  'KGMMMMMMMMMGK...',
  'KGMMMMMMMMMGK...',
  '.KGMMMMMMMGK....',
  '.KGGMMMMMGGK....',
  '..KKGGGGGKKY....',
  '....KKKKK.KYY...',
  '...........KYYK.',
  '............KYYK',
  '.............KYK',
  '..............K.',
];
const COLOR = { K: '#141414', G: '#1a9b5a', M: '#bdf5d6', W: '#ffffff', Y: '#f6c51b' };

export default function Brand({ size = 54 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {MAP.flatMap((row, y) => [...row].map((ch, x) => (COLOR[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={COLOR[ch]} /> : null)))}
    </svg>
  );
}
