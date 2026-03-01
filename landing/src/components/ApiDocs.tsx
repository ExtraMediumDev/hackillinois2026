import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import { FiArrowLeft } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import DecryptedText from './DecryptedText';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';
const API_DOCS_URL = import.meta.env.VITE_API_DOCS_URL ?? `${API_BASE.replace(/\/$/, '')}/docs/json`;

export default function ApiDocs() {
    return (
        <div className="api-docs-container">
            <div className="docs-header">
                <div className="docs-top-bar">
                    <Link to="/" className="primary-btn docs-back-btn">
                        <FiArrowLeft style={{ marginRight: '0.5rem' }} />
                        Back to Home
                    </Link>
                </div>

                <h1 className="docs-title">
                    <DecryptedText
                        text="Splice API Documentation"
                        animateOn="view"
                        sequential
                        speed={70}
                        className="headline docs-headline"
                        encryptedClassName="headline encrypted docs-headline"
                    />
                </h1>
            </div>

            <div className="swagger-wrapper">
                <SwaggerUI url={API_DOCS_URL} />
            </div>
        </div>
    );
}
