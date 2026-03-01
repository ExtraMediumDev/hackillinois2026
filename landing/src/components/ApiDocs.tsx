import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import { FiArrowLeft } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import DecryptedText from './DecryptedText';

export default function ApiDocs() {
    return (
        <div className="api-docs-container">
            <div className="docs-header" style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <Link to="/" className="primary-btn" style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', padding: '0.6rem 1.2rem', fontSize: '0.9rem' }}>
                    <FiArrowLeft style={{ marginRight: '0.5rem' }} />
                    Back to Home
                </Link>

                <h1 style={{ margin: 0 }}>
                    <DecryptedText
                        text="Splice API"
                        animateOn="view"
                        sequential
                        speed={70}
                        className="headline"
                        encryptedClassName="headline encrypted"
                    />
                </h1>
            </div>

            <div className="swagger-wrapper">
                <SwaggerUI url="http://localhost:3000/docs/json" />
            </div>
        </div>
    );
}
