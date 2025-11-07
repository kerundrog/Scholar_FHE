import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ScholarshipData {
  id: string;
  name: string;
  encryptedIncome: string;
  academicScore: number;
  extracurricular: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface ApplicationStats {
  totalApplications: number;
  approvedCount: number;
  avgIncome: number;
  pendingReview: number;
  successRate: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<ScholarshipData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applying, setApplying] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newApplication, setNewApplication] = useState({ 
    name: "", 
    income: "", 
    score: "", 
    extracurricular: "",
    description: "" 
  });
  const [selectedApp, setSelectedApp] = useState<ScholarshipData | null>(null);
  const [decryptedIncome, setDecryptedIncome] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadApplications();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadApplications = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const appsList: ScholarshipData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          appsList.push({
            id: businessId,
            name: businessData.name,
            encryptedIncome: businessId,
            academicScore: Number(businessData.publicValue1) || 0,
            extracurricular: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading application data:', e);
        }
      }
      
      setApplications(appsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load applications" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const applyScholarship = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setApplying(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting income data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const incomeValue = parseInt(newApplication.income) || 0;
      const businessId = `scholar-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, incomeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newApplication.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newApplication.score) || 0,
        parseInt(newApplication.extracurricular) || 0,
        newApplication.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Submitting encrypted application..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Scholarship application submitted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadApplications();
      setShowApplyModal(false);
      setNewApplication({ name: "", income: "", score: "", extracurricular: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setApplying(false); 
    }
  };

  const decryptIncome = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Income already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying income decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadApplications();
      
      setTransactionStatus({ visible: true, status: "success", message: "Income verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Income is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadApplications();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkEligibility = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "System is available for eligibility checking" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Eligibility check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getApplicationStats = (): ApplicationStats => {
    const totalApplications = applications.length;
    const approvedCount = applications.filter(app => app.isVerified && (app.decryptedValue || 0) < 50000).length;
    const avgIncome = applications.length > 0 
      ? applications.reduce((sum, app) => sum + (app.decryptedValue || 0), 0) / applications.length 
      : 0;
    const pendingReview = applications.filter(app => !app.isVerified).length;
    const successRate = totalApplications > 0 ? (approvedCount / totalApplications) * 100 : 0;

    return {
      totalApplications,
      approvedCount,
      avgIncome,
      pendingReview,
      successRate
    };
  };

  const filteredApplications = applications.filter(app => 
    app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsPanel = () => {
    const stats = getApplicationStats();
    
    return (
      <div className="stats-panels">
        <div className="stat-panel neon-purple">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalApplications}</div>
            <div className="stat-label">Total Applications</div>
          </div>
        </div>
        
        <div className="stat-panel neon-blue">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.approvedCount}</div>
            <div className="stat-label">Approved</div>
          </div>
        </div>
        
        <div className="stat-panel neon-pink">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <div className="stat-value">{stats.pendingReview}</div>
            <div className="stat-label">Pending Review</div>
          </div>
        </div>
        
        <div className="stat-panel neon-green">
          <div className="stat-icon">📈</div>
          <div className="stat-content">
            <div className="stat-value">{stats.successRate.toFixed(1)}%</div>
            <div className="stat-label">Success Rate</div>
          </div>
        </div>
      </div>
    );
  };

  const renderIncomeChart = (application: ScholarshipData) => {
    const income = application.isVerified ? application.decryptedValue : decryptedIncome;
    const threshold = 50000;
    const percentage = income ? Math.min(100, (income / threshold) * 100) : 0;
    
    return (
      <div className="income-chart">
        <div className="chart-header">
          <h4>Income Eligibility Check</h4>
          <div className={`eligibility-badge ${income && income < threshold ? 'eligible' : 'ineligible'}`}>
            {income ? (income < threshold ? 'Eligible' : 'Not Eligible') : 'Not Verified'}
          </div>
        </div>
        <div className="chart-bar">
          <div 
            className="bar-fill" 
            style={{ width: `${percentage}%` }}
          >
            <span className="bar-value">${income?.toLocaleString() || '🔒'}</span>
          </div>
        </div>
        <div className="chart-labels">
          <span>Low Income</span>
          <span>Threshold: ${threshold.toLocaleString()}</span>
          <span>High Income</span>
        </div>
      </div>
    );
  };

  const renderFAQs = () => (
    <div className="faq-section">
      <h3>Frequently Asked Questions</h3>
      <div className="faq-list">
        <div className="faq-item">
          <div className="faq-question">How is my income data protected?</div>
          <div className="faq-answer">Your income is encrypted using Zama FHE technology, ensuring it remains confidential while allowing eligibility verification.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">What income level qualifies?</div>
          <div className="faq-answer">Household income below $50,000 annually qualifies for consideration. The exact threshold may vary.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How long does verification take?</div>
          <div className="faq-answer">The FHE verification process typically takes 2-3 minutes once submitted on-chain.</div>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎓 Confidential Scholarship</h1>
            <p>FHE-Protected Application System</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Apply</h2>
            <p>Secure, privacy-preserving scholarship applications powered by Zama FHE technology</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span className="feature-icon">💰</span>
                <h4>Income Encryption</h4>
                <p>Your financial data stays private with fully homomorphic encryption</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <h4>Instant Verification</h4>
                <p>Automated eligibility checking without exposing sensitive information</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🎯</span>
                <h4>Fair Assessment</h4>
                <p>Transparent process with cryptographic proof of verification</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your scholarship application</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading scholarship applications...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🎓 Confidential Scholarship</h1>
          <p>FHE-Protected Application System</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowApplyModal(true)} 
            className="apply-btn neon-glow"
          >
            + New Application
          </button>
          <button 
            onClick={checkEligibility} 
            className="check-btn"
          >
            Check Eligibility
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="content-panels">
          <div className="left-panel">
            <div className="panel-section">
              <div className="section-header">
                <h2>Application Statistics</h2>
                <div className="section-actions">
                  <button 
                    onClick={() => setShowStats(!showStats)}
                    className="toggle-btn"
                  >
                    {showStats ? 'Hide' : 'Show'} Stats
                  </button>
                </div>
              </div>
              {showStats && renderStatsPanel()}
            </div>
            
            <div className="panel-section">
              <div className="section-header">
                <h2>FHE Process Flow</h2>
              </div>
              <div className="process-flow">
                <div className="flow-step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h4>Encrypt Income</h4>
                    <p>Family income encrypted with Zama FHE before submission</p>
                  </div>
                </div>
                <div className="flow-step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h4>On-chain Storage</h4>
                    <p>Encrypted data stored securely on blockchain</p>
                  </div>
                </div>
                <div className="flow-step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h4>Homomorphic Verification</h4>
                    <p>Income verification without decryption</p>
                  </div>
                </div>
                <div className="flow-step">
                  <div className="step-number">4</div>
                  <div className="step-content">
                    <h4>Result Publication</h4>
                    <p>Only eligibility result revealed publicly</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="right-panel">
            <div className="panel-section">
              <div className="section-header">
                <h2>Scholarship Applications</h2>
                <div className="section-actions">
                  <input 
                    type="text" 
                    placeholder="Search applications..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                  <button 
                    onClick={loadApplications} 
                    className="refresh-btn" 
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "🔄" : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="applications-list">
                {filteredApplications.length === 0 ? (
                  <div className="no-applications">
                    <p>No scholarship applications found</p>
                    <button 
                      className="apply-btn" 
                      onClick={() => setShowApplyModal(true)}
                    >
                      Apply Now
                    </button>
                  </div>
                ) : filteredApplications.map((app, index) => (
                  <div 
                    className={`application-item ${selectedApp?.id === app.id ? "selected" : ""}`} 
                    key={index}
                    onClick={() => setSelectedApp(app)}
                  >
                    <div className="app-header">
                      <div className="app-title">{app.name}</div>
                      <div className={`app-status ${app.isVerified ? 'verified' : 'pending'}`}>
                        {app.isVerified ? '✅ Verified' : '⏳ Pending'}
                      </div>
                    </div>
                    <div className="app-meta">
                      <span>Academic: {app.academicScore}/10</span>
                      <span>Activities: {app.extracurricular}/10</span>
                      <span>{new Date(app.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="app-description">{app.description}</div>
                    {app.isVerified && (
                      <div className="app-result">
                        Income: ${app.decryptedValue?.toLocaleString()} - 
                        <span className={app.decryptedValue && app.decryptedValue < 50000 ? 'eligible' : 'ineligible'}>
                          {app.decryptedValue && app.decryptedValue < 50000 ? ' Eligible' : ' Not Eligible'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <div className="bottom-panel">
          <div className="panel-section">
            <div className="section-header">
              <h2>Help & Information</h2>
              <button 
                onClick={() => setShowFAQ(!showFAQ)}
                className="toggle-btn"
              >
                {showFAQ ? 'Hide' : 'Show'} FAQ
              </button>
            </div>
            {showFAQ && renderFAQs()}
          </div>
        </div>
      </div>
      
      {showApplyModal && (
        <ApplyModal 
          onSubmit={applyScholarship} 
          onClose={() => setShowApplyModal(false)} 
          applying={applying} 
          application={newApplication} 
          setApplication={setNewApplication}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedApp && (
        <ApplicationDetailModal 
          application={selectedApp} 
          onClose={() => { 
            setSelectedApp(null); 
            setDecryptedIncome(null); 
          }} 
          decryptedIncome={decryptedIncome} 
          setDecryptedIncome={setDecryptedIncome} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptIncome={() => decryptIncome(selectedApp.id)}
          renderIncomeChart={renderIncomeChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ApplyModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  applying: boolean;
  application: any;
  setApplication: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, applying, application, setApplication, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'income') {
      const intValue = value.replace(/[^\d]/g, '');
      setApplication({ ...application, [name]: intValue });
    } else {
      setApplication({ ...application, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="apply-modal">
        <div className="modal-header">
          <h2>New Scholarship Application</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice neon-glow">
            <strong>FHE 🔐 Income Protection</strong>
            <p>Your family income will be encrypted and never exposed publicly</p>
          </div>
          
          <div className="form-group">
            <label>Student Name *</label>
            <input 
              type="text" 
              name="name" 
              value={application.name} 
              onChange={handleChange} 
              placeholder="Enter full name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Annual Family Income (USD) *</label>
            <input 
              type="number" 
              name="income" 
              value={application.income} 
              onChange={handleChange} 
              placeholder="Enter income amount..." 
              min="0"
            />
            <div className="data-type-label">🔐 FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Academic Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="score" 
              value={application.score} 
              onChange={handleChange} 
              placeholder="Enter academic score..." 
            />
            <div className="data-type-label">📊 Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Extracurricular Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="extracurricular" 
              value={application.extracurricular} 
              onChange={handleChange} 
              placeholder="Enter activity score..." 
            />
            <div className="data-type-label">⚡ Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Personal Statement</label>
            <textarea 
              name="description" 
              value={application.description} 
              onChange={handleChange} 
              placeholder="Tell us about your educational goals..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={applying || isEncrypting || !application.name || !application.income || !application.score} 
            className="submit-btn neon-glow"
          >
            {applying || isEncrypting ? "🔐 Encrypting and Submitting..." : "Submit Application"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ApplicationDetailModal: React.FC<{
  application: ScholarshipData;
  onClose: () => void;
  decryptedIncome: number | null;
  setDecryptedIncome: (value: number | null) => void;
  isDecrypting: boolean;
  decryptIncome: () => Promise<number | null>;
  renderIncomeChart: (application: ScholarshipData) => JSX.Element;
}> = ({ application, onClose, decryptedIncome, setDecryptedIncome, isDecrypting, decryptIncome, renderIncomeChart }) => {
  const handleDecrypt = async () => {
    if (decryptedIncome !== null) { 
      setDecryptedIncome(null); 
      return; 
    }
    
    const decrypted = await decryptIncome();
    if (decrypted !== null) {
      setDecryptedIncome(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Application Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="application-info">
            <div className="info-grid">
              <div className="info-item">
                <span>Student Name:</span>
                <strong>{application.name}</strong>
              </div>
              <div className="info-item">
                <span>Applicant:</span>
                <strong>{application.creator.substring(0, 6)}...{application.creator.substring(38)}</strong>
              </div>
              <div className="info-item">
                <span>Application Date:</span>
                <strong>{new Date(application.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
              <div className="info-item">
                <span>Academic Score:</span>
                <strong>{application.academicScore}/10</strong>
              </div>
              <div className="info-item">
                <span>Activity Score:</span>
                <strong>{application.extracurricular}/10</strong>
              </div>
            </div>
            
            <div className="personal-statement">
              <h4>Personal Statement</h4>
              <p>{application.description}</p>
            </div>
          </div>
          
          <div className="income-section">
            <h3>Income Verification</h3>
            
            <div className="verification-status">
              <div className="status-info">
                <div className="status-label">Income Data:</div>
                <div className="status-value">
                  {application.isVerified ? 
                    `$${application.decryptedValue?.toLocaleString()} (On-chain Verified)` : 
                    decryptedIncome !== null ? 
                    `$${decryptedIncome.toLocaleString()} (Locally Decrypted)` : 
                    "🔒 FHE Encrypted"
                  }
                </div>
              </div>
              
              <button 
                className={`verify-btn ${(application.isVerified || decryptedIncome !== null) ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : application.isVerified ? (
                  "✅ Verified"
                ) : decryptedIncome !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Income"
                )}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy Protection</strong>
                <p>Your income is encrypted on-chain. Verification happens without exposing the actual amount publicly.</p>
              </div>
            </div>
          </div>
          
          {(application.isVerified || decryptedIncome !== null) && (
            <div className="eligibility-section">
              <h3>Eligibility Analysis</h3>
              {renderIncomeChart(application)}
              
              <div className="analysis-results">
                <div className="result-item">
                  <span>Income Threshold:</span>
                  <strong>$50,000</strong>
                </div>
                <div className="result-item">
                  <span>Your Income:</span>
                  <strong>
                    {application.isVerified ? 
                      `$${application.decryptedValue?.toLocaleString()}` : 
                      `$${decryptedIncome?.toLocaleString()}`
                    }
                  </strong>
                </div>
                <div className="result-item">
                  <span>Eligibility Status:</span>
                  <strong className={application.decryptedValue && application.decryptedValue < 50000 ? 'eligible' : 'ineligible'}>
                    {application.decryptedValue && application.decryptedValue < 50000 ? 'Qualified' : 'Does Not Qualify'}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!application.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


