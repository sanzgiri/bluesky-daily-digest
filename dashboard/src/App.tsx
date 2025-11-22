import { useState, useEffect } from 'react';
import { format, parseISO, getYear, getMonth } from 'date-fns';
import { Layout, Menu, FileText, Calendar } from 'lucide-react';
import DigestViewer from './components/DigestViewer';
import clsx from 'clsx';

interface Digest {
    filename: string;
    date: string;
    size: number;
}

function App() {
    const [digests, setDigests] = useState<Digest[]>([]);
    const [selectedDigest, setSelectedDigest] = useState<Digest | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('./digests.json')
            .then(res => res.json())
            .then(data => {
                setDigests(data);
                if (data.length > 0) {
                    setSelectedDigest(data[0]);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load digests:', err);
                setLoading(false);
            });
    }, []);

    // Group digests by Year -> Month
    const groupedDigests = digests.reduce((acc, digest) => {
        const date = parseISO(digest.date);
        const year = getYear(date);
        const month = format(date, 'MMMM');

        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = [];

        acc[year][month].push(digest);
        return acc;
    }, {} as Record<string, Record<string, Digest[]>>);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bluesky-500"></div>
            </div>
        );
    }

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50">
            {/* Sidebar */}
            <aside className="w-80 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-6 border-b border-slate-100">
                    <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Layout className="w-6 h-6 text-bluesky-500" />
                        Bluesky Digest
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Daily AI Summaries</p>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {Object.keys(groupedDigests).sort().reverse().map(year => (
                        <div key={year} className="mb-6">
                            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 pl-2">
                                {year}
                            </h2>
                            {Object.keys(groupedDigests[year]).map(month => (
                                <div key={month} className="mb-4">
                                    <h3 className="text-sm font-medium text-slate-600 mb-2 pl-2 flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        {month}
                                    </h3>
                                    <div className="space-y-1">
                                        {groupedDigests[year][month].map(digest => (
                                            <button
                                                key={digest.filename}
                                                onClick={() => setSelectedDigest(digest)}
                                                className={clsx(
                                                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-3",
                                                    selectedDigest?.filename === digest.filename
                                                        ? "bg-bluesky-50 text-bluesky-600 font-medium"
                                                        : "text-slate-600 hover:bg-slate-100"
                                                )}
                                            >
                                                <FileText className="w-4 h-4 flex-shrink-0" />
                                                <span className="truncate">
                                                    {format(parseISO(digest.date), 'EEE, MMM do')}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}

                    {digests.length === 0 && (
                        <div className="text-center py-10 text-slate-500">
                            No digests found.
                        </div>
                    )}
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto">
                {selectedDigest ? (
                    <DigestViewer digest={selectedDigest} />
                ) : (
                    <div className="flex items-center justify-center h-full text-slate-400">
                        Select a digest to view
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
