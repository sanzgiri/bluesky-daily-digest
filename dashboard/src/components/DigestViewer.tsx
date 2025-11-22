import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { format, parseISO } from 'date-fns';
import { Clock, Calendar } from 'lucide-react';

interface Digest {
    filename: string;
    date: string;
}

interface DigestViewerProps {
    digest: Digest;
}

export default function DigestViewer({ digest }: DigestViewerProps) {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetch(`./digests/${digest.filename}`)
            .then(res => res.text())
            .then(text => {
                setContent(text);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load digest content:', err);
                setContent('# Error\nFailed to load content.');
                setLoading(false);
            });
    }, [digest]);

    if (loading) {
        return (
            <div className="p-12 flex justify-center">
                <div className="animate-pulse flex space-x-4">
                    <div className="flex-1 space-y-4 py-1">
                        <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                        <div className="space-y-2">
                            <div className="h-4 bg-slate-200 rounded"></div>
                            <div className="h-4 bg-slate-200 rounded w-5/6"></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-8 lg:p-12">
            <header className="mb-8 pb-8 border-b border-slate-200">
                <h1 className="text-3xl font-bold text-slate-900 mb-4">
                    Daily Digest
                </h1>
                <div className="flex items-center gap-6 text-slate-500 text-sm">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {format(parseISO(digest.date), 'EEEE, MMMM do, yyyy')}
                    </div>
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {format(parseISO(digest.date), 'h:mm a')}
                    </div>
                </div>
            </header>

            <article className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-a:text-bluesky-600 prose-img:rounded-xl">
                <ReactMarkdown>{content}</ReactMarkdown>
            </article>
        </div>
    );
}
