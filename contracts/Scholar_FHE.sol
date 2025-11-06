pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ScholarFHE is ZamaEthereumConfig {
    struct Application {
        string studentId;
        euint32 encryptedIncome;
        uint256 publicThreshold;
        string description;
        address applicant;
        uint256 timestamp;
        bool isQualified;
        uint32 decryptedIncome;
    }

    mapping(string => Application) public applications;
    string[] public applicationIds;

    event ApplicationSubmitted(string indexed applicationId, address indexed applicant);
    event QualificationVerified(string indexed applicationId, bool isQualified);

    constructor() ZamaEthereumConfig() {
        // Initialize contract with Zama configuration
    }

    function submitApplication(
        string calldata applicationId,
        string calldata studentId,
        externalEuint32 encryptedIncome,
        bytes calldata inputProof,
        uint256 publicThreshold,
        string calldata description
    ) external {
        require(bytes(applications[applicationId].studentId).length == 0, "Application already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedIncome, inputProof)), "Invalid encrypted input");

        applications[applicationId] = Application({
            studentId: studentId,
            encryptedIncome: FHE.fromExternal(encryptedIncome, inputProof),
            publicThreshold: publicThreshold,
            description: description,
            applicant: msg.sender,
            timestamp: block.timestamp,
            isQualified: false,
            decryptedIncome: 0
        });

        FHE.allowThis(applications[applicationId].encryptedIncome);
        FHE.makePubliclyDecryptable(applications[applicationId].encryptedIncome);
        applicationIds.push(applicationId);

        emit ApplicationSubmitted(applicationId, msg.sender);
    }

    function verifyQualification(
        string calldata applicationId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(applications[applicationId].studentId).length > 0, "Application does not exist");
        require(!applications[applicationId].isQualified, "Qualification already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(applications[applicationId].encryptedIncome);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedIncome = abi.decode(abiEncodedClearValue, (uint32));

        bool isQualified = decodedIncome < applications[applicationId].publicThreshold;
        applications[applicationId].isQualified = isQualified;
        applications[applicationId].decryptedIncome = decodedIncome;

        emit QualificationVerified(applicationId, isQualified);
    }

    function getEncryptedIncome(string calldata applicationId) external view returns (euint32) {
        require(bytes(applications[applicationId].studentId).length > 0, "Application does not exist");
        return applications[applicationId].encryptedIncome;
    }

    function getApplication(string calldata applicationId) external view returns (
        string memory studentId,
        uint256 publicThreshold,
        string memory description,
        address applicant,
        uint256 timestamp,
        bool isQualified,
        uint32 decryptedIncome
    ) {
        require(bytes(applications[applicationId].studentId).length > 0, "Application does not exist");
        Application storage app = applications[applicationId];

        return (
            app.studentId,
            app.publicThreshold,
            app.description,
            app.applicant,
            app.timestamp,
            app.isQualified,
            app.decryptedIncome
        );
    }

    function getAllApplicationIds() external view returns (string[] memory) {
        return applicationIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


