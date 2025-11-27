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
  familyIncome: string;
  academicScore: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [scholarships, setScholarships] = useState<ScholarshipData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingScholarship, setCreatingScholarship] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newScholarshipData, setNewScholarshipData] = useState({ 
    name: "", 
    familyIncome: "", 
    academicScore: "" 
  });
  const [selectedScholarship, setSelectedScholarship] = useState<ScholarshipData | null>(null);
  const [decryptedIncome, setDecryptedIncome] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

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
        await loadData();
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

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const scholarshipsList: ScholarshipData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          scholarshipsList.push({
            id: businessId,
            name: businessData.name,
            familyIncome: businessId,
            academicScore: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setScholarships(scholarshipsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createScholarship = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingScholarship(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating scholarship application with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const familyIncomeValue = parseInt(newScholarshipData.familyIncome) || 0;
      const businessId = `scholarship-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, familyIncomeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newScholarshipData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newScholarshipData.academicScore) || 0,
        0,
        "Scholarship Application"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Scholarship application submitted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewScholarshipData({ name: "", familyIncome: "", academicScore: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingScholarship(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
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
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Income data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkEligibility = async () => {
    if (!isConnected) return;
    
    setTransactionStatus({ visible: true, status: "pending", message: "Checking system availability..." });
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available for eligibility verification!" });
      } else {
        setTransactionStatus({ visible: true, status: "error", message: "System temporarily unavailable" });
      }
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    }
    
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
  };

  const filteredScholarships = scholarships.filter(scholarship => {
    const matchesSearch = scholarship.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || scholarship.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: scholarships.length,
    verified: scholarships.filter(s => s.isVerified).length,
    eligible: scholarships.filter(s => s.isVerified && (s.decryptedValue || 0) < 30000).length,
    pending: scholarships.filter(s => !s.isVerified).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎓 Confidential Scholarship</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Apply</h2>
            <p>Secure scholarship application with fully homomorphic encryption protecting your financial privacy.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to begin</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Submit encrypted income data securely</p>
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
        <p className="loading-note">Securing your financial data with Zama FHE</p>
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
          <span className="tagline">FHE-Protected Financial Privacy</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkEligibility} className="eligibility-btn">
            Check Eligibility
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Application
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Applications</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Income Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.eligible}</div>
            <div className="stat-label">Eligible</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.pending}</div>
            <div className="stat-label">Pending Review</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search applications..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-options">
            <label>
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Show Verified Only
            </label>
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="applications-grid">
          {filteredScholarships.length === 0 ? (
            <div className="no-applications">
              <p>No scholarship applications found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Application
              </button>
            </div>
          ) : (
            filteredScholarships.map((scholarship, index) => (
              <div 
                className={`application-card ${selectedScholarship?.id === scholarship.id ? "selected" : ""} ${scholarship.isVerified ? "verified" : "pending"}`} 
                key={index}
                onClick={() => setSelectedScholarship(scholarship)}
              >
                <div className="card-header">
                  <h3>{scholarship.name}</h3>
                  <span className={`status-badge ${scholarship.isVerified ? "verified" : "pending"}`}>
                    {scholarship.isVerified ? "✅ Verified" : "⏳ Pending"}
                  </span>
                </div>
                <div className="card-content">
                  <div className="info-row">
                    <span>Academic Score:</span>
                    <strong>{scholarship.publicValue1}/100</strong>
                  </div>
                  <div className="info-row">
                    <span>Income Status:</span>
                    <strong>{scholarship.isVerified ? `$${scholarship.decryptedValue}` : "🔒 Encrypted"}</strong>
                  </div>
                  <div className="info-row">
                    <span>Applied:</span>
                    <strong>{new Date(scholarship.timestamp * 1000).toLocaleDateString()}</strong>
                  </div>
                </div>
                <div className="card-footer">
                  <span className="creator">By: {scholarship.creator.substring(0, 8)}...</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateScholarship 
          onSubmit={createScholarship} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingScholarship} 
          scholarshipData={newScholarshipData} 
          setScholarshipData={setNewScholarshipData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedScholarship && (
        <ScholarshipDetailModal 
          scholarship={selectedScholarship} 
          onClose={() => { 
            setSelectedScholarship(null); 
            setDecryptedIncome(null); 
          }} 
          decryptedIncome={decryptedIncome} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedScholarship.id)}
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

      <footer className="app-footer">
        <div className="footer-content">
          <p>🔐 Powered by Zama FHE - Your financial privacy is protected</p>
          <div className="footer-links">
            <span>FHE Technology</span>
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const ModalCreateScholarship: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  scholarshipData: any;
  setScholarshipData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, scholarshipData, setScholarshipData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'familyIncome') {
      const intValue = value.replace(/[^\d]/g, '');
      setScholarshipData({ ...scholarshipData, [name]: intValue });
    } else {
      setScholarshipData({ ...scholarshipData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>New Scholarship Application</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Privacy Protection</strong>
            <p>Your family income will be encrypted with Zama FHE - only you can decrypt it</p>
          </div>
          
          <div className="form-group">
            <label>Student Name *</label>
            <input 
              type="text" 
              name="name" 
              value={scholarshipData.name} 
              onChange={handleChange} 
              placeholder="Enter your full name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Family Annual Income (USD) *</label>
            <input 
              type="number" 
              name="familyIncome" 
              value={scholarshipData.familyIncome} 
              onChange={handleChange} 
              placeholder="Enter income amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">🔐 FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Academic Score (0-100) *</label>
            <input 
              type="number" 
              min="0" 
              max="100" 
              name="academicScore" 
              value={scholarshipData.academicScore} 
              onChange={handleChange} 
              placeholder="Enter academic score..." 
            />
            <div className="data-type-label">📊 Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !scholarshipData.name || !scholarshipData.familyIncome || !scholarshipData.academicScore} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Submitting..." : "Submit Application"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ScholarshipDetailModal: React.FC<{
  scholarship: ScholarshipData;
  onClose: () => void;
  decryptedIncome: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ scholarship, onClose, decryptedIncome, isDecrypting, decryptData }) => {
  const [localDecryptedIncome, setLocalDecryptedIncome] = useState<number | null>(decryptedIncome);

  const handleDecrypt = async () => {
    if (localDecryptedIncome !== null) { 
      setLocalDecryptedIncome(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    setLocalDecryptedIncome(decrypted);
  };

  const isEligible = scholarship.isVerified ? (scholarship.decryptedValue || 0) < 30000 : localDecryptedIncome ? localDecryptedIncome < 30000 : false;

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Application Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="applicant-info">
            <div className="info-item">
              <span>Student Name:</span>
              <strong>{scholarship.name}</strong>
            </div>
            <div className="info-item">
              <span>Applicant:</span>
              <strong>{scholarship.creator.substring(0, 8)}...{scholarship.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Application Date:</span>
              <strong>{new Date(scholarship.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Academic Score:</span>
              <strong>{scholarship.publicValue1}/100</strong>
            </div>
          </div>
          
          <div className="income-section">
            <h3>Family Income Verification</h3>
            
            <div className="income-display">
              <div className="income-value">
                {scholarship.isVerified ? 
                  `$${scholarship.decryptedValue} (On-chain Verified)` : 
                  localDecryptedIncome !== null ? 
                  `$${localDecryptedIncome} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              
              <button 
                className={`decrypt-btn ${(scholarship.isVerified || localDecryptedIncome !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Verifying..." :
                 scholarship.isVerified ? "✅ Verified" :
                 localDecryptedIncome !== null ? "🔄 Re-verify" : "🔓 Verify Income"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-icon">🔐</div>
              <p>Your income data is encrypted on-chain using FHE. Verification happens offline with on-chain proof validation.</p>
            </div>
          </div>
          
          {(scholarship.isVerified || localDecryptedIncome !== null) && (
            <div className="eligibility-section">
              <h3>Eligibility Assessment</h3>
              
              <div className={`eligibility-result ${isEligible ? 'eligible' : 'not-eligible'}`}>
                <div className="result-icon">{isEligible ? "✅" : "❌"}</div>
                <div className="result-text">
                  <strong>{isEligible ? "Eligible for Scholarship" : "Not Eligible"}</strong>
                  <p>{isEligible ? 
                    "Meets income requirements for scholarship consideration" : 
                    "Income exceeds scholarship eligibility threshold"
                  }</p>
                </div>
              </div>
              
              <div className="eligibility-criteria">
                <div className="criterion">
                  <span>Income Threshold:</span>
                  <strong>&lt; $30,000</strong>
                </div>
                <div className="criterion">
                  <span>Your Income:</span>
                  <strong>${scholarship.isVerified ? scholarship.decryptedValue : localDecryptedIncome}</strong>
                </div>
                <div className="criterion">
                  <span>Academic Minimum:</span>
                  <strong>60/100</strong>
                </div>
                <div className="criterion">
                  <span>Your Score:</span>
                  <strong>{scholarship.publicValue1}/100</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!scholarship.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;