import Link from 'next/link';
import { useEffect, useState } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function Home() {
  const [orgs, setOrgs] = useState([]);
  useEffect(() => {
    const q = query(collection(db, 'orgs'));
    const unsub = onSnapshot(q, (snap) => setOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    return () => unsub();
  }, []);
  return (
    <div style={{padding:20}}>
      <h1>The Popcorn Boutique — Fundraisers</h1>
      <ul>
        {orgs.map(o => <li key={o.id}><Link href={`/org/${o.code}`}>{o.name}</Link></li>)}
      </ul>
    </div>
  );
}
