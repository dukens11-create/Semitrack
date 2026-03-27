import { useEffect, useState } from "react";

type FleetResponse = {
  companyId: string;
  drivers: { id: string; name: string; truckUnit: string; status: string; lat: number; lng: number }[];
};

type LoadsResponse = {
  total: number;
  loads: { id: string; brokerName: string; originCity: string; originState: string; destinationCity: string; destinationState: string; equipmentType: string; weightLbs: number; rateUsd: number }[];
};

type DocumentsResponse = {
  companyId: string;
  items: { id: string; type: string; fileName: string; fileUrl: string }[];
};

const API = "http://localhost:4000";

export function App() {
  const [fleet, setFleet] = useState<FleetResponse | null>(null);
  const [loads, setLoads] = useState<LoadsResponse | null>(null);
  const [docs, setDocs] = useState<DocumentsResponse | null>(null);

  useEffect(() => {
    fetch(`${API}/fleet/live`).then((r) => r.json()).then(setFleet);
    fetch(`${API}/load-board/search`).then((r) => r.json()).then(setLoads);
    fetch(`${API}/documents/company`).then((r) => r.json()).then(setDocs);
  }, []);

  return (
    <div className="page">
      <h1>Semitrack Admin Dashboard</h1>

      <div className="stats">
        <Card title="Active Drivers" value={String(fleet?.drivers.length ?? 0)} />
        <Card title="Loads" value={String(loads?.total ?? 0)} />
        <Card title="Docs" value={String(docs?.items.length ?? 0)} />
        <Card title="System" value="Online" />
      </div>

      <section className="panel">
        <h2>Fleet</h2>
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Truck</th>
              <th>Status</th>
              <th>Coordinates</th>
            </tr>
          </thead>
          <tbody>
            {fleet?.drivers.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.truckUnit}</td>
                <td>{d.status}</td>
                <td>{d.lat}, {d.lng}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Load Board</h2>
        <table>
          <thead>
            <tr>
              <th>Broker</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Equipment</th>
              <th>Weight</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {loads?.loads.map((l) => (
              <tr key={l.id}>
                <td>{l.brokerName}</td>
                <td>{l.originCity}, {l.originState}</td>
                <td>{l.destinationCity}, {l.destinationState}</td>
                <td>{l.equipmentType}</td>
                <td>{l.weightLbs.toLocaleString()} lbs</td>
                <td>${l.rateUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Documents</h2>
        <ul>
          {docs?.items.map((d) => (
            <li key={d.id}>
              <strong>{d.fileName}</strong> — {d.type}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="card">
      <div className="card-value">{value}</div>
      <div className="card-title">{title}</div>
    </div>
  );
}
