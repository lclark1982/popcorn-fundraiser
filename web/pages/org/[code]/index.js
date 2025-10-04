import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, getDocs } from 'firebase/firestore';
import { db, createCheckout } from '../../../lib/firebase';

export default function OrgPage() {
  const router = useRouter();
  const { code } = router.query;
  const [org, setOrg] = useState(null);
  const [sellers, setSellers] = useState([]);

  useEffect(() => {
    if (!code) return;
    (async () => {
      const snap = await getDocs(query(collection(db,'orgs'), where('code','==',code)));
      if (snap.empty) return;
      const doc = snap.docs[0];
      setOrg({ id: doc.id, ...doc.data() });
      const sellersRef = collection(db, `orgs/${doc.id}/sellers`);
      const unsub = onSnapshot(sellersRef, s => setSellers(s.docs.map(d=>({id:d.id,...d.data()}))));
      return () => unsub();
    })();
  }, [code]);

  const buy = async (sellerId) => {
    try {
      const res = await createCheckout({ orgId: org.id, sellerId, successUrl: window.location.href+'?success=1', cancelUrl: window.location.href+'?cancel=1' });
      const url = res.data?.url;
      if (url) window.location = url;
    } catch (err) {
      alert(err.message || 'Checkout failed');
    }
  };

  if (!org) return <div style={{padding:20}}>Loading...</div>;
  return (
    <div style={{padding:20}}>
      <h1>{org.name}</h1>
      <p>{org.intro}</p>
      <h3>Sellers</h3>
      <ul>
        {sellers.map(s => (
          <li key={s.id}>{s.name} — ${(s.salesCents||0)/100} <button onClick={() => buy(s.id)}>Buy for this seller</button></li>
        ))}
      </ul>
    </div>
  );
}
