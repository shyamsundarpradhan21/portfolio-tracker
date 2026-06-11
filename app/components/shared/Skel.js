'use client';
export default function Skel({ w = 90, h = 18 }) {
  return <span className="skel" style={{ width: w, height: h, display: 'inline-block' }}>&nbsp;</span>;
}
