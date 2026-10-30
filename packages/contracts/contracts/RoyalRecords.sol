// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Only trusted server attestors can anchor validated results or award achievements.
contract RoyalRecords is ERC1155, AccessControl, EIP712 {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    struct Record { bytes32 resultHash; bytes32 winner; uint64 timestamp; address attestor; }
    mapping(bytes32 => Record) public records;
    mapping(address => mapping(uint256 => bool)) public awarded;
    mapping(address => bytes32) public profiles;
    mapping(bytes32 => address) public profileOwners;
    bytes32 private constant REGISTER_TYPEHASH = keccak256("RegisterProfile(address owner,bytes32 profileId,uint256 deadline,bytes32 nonce)");
    event ProfileRegistered(address indexed owner, bytes32 indexed profileId);
    event MatchAttested(bytes32 indexed matchId, bytes32 resultHash, bytes32 winner, address indexed attestor);
    error AlreadyAttested();
    error AlreadyAwarded();
    error InvalidRecord();
    error InvalidRegistration();
    constructor(address admin, string memory metadataURI) ERC1155(metadataURI) EIP712("KibreGugsProfiles", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTOR_ROLE, admin);
    }
    /// @notice A relayer pays gas, but cannot register a wallet without its signed consent.
    /// @dev Addresses and profile digests are immutable, unique and scoped to this chain/deployment.
    function registerProfile(address owner, bytes32 profileId, uint256 deadline, bytes32 nonce, bytes calldata signature) external onlyRole(ATTESTOR_ROLE) {
        if (owner == address(0) || profileId == bytes32(0) || profiles[owner] != bytes32(0) || profileOwners[profileId] != address(0) || deadline < block.timestamp) revert InvalidRegistration();
        bytes32 typedHash = _hashTypedDataV4(keccak256(abi.encode(REGISTER_TYPEHASH, owner, profileId, deadline, nonce)));
        if (ECDSA.recover(typedHash, signature) != owner) revert InvalidRegistration();
        profiles[owner] = profileId;
        profileOwners[profileId] = owner;
        emit ProfileRegistered(owner, profileId);
    }
    function attest(bytes32 matchId, bytes32 resultHash, bytes32 winner) external onlyRole(ATTESTOR_ROLE) {
        if (records[matchId].timestamp != 0) revert AlreadyAttested();
        if (matchId == bytes32(0) || resultHash == bytes32(0)) revert InvalidRecord();
        records[matchId] = Record(resultHash, winner, uint64(block.timestamp), msg.sender);
        emit MatchAttested(matchId, resultHash, winner, msg.sender);
    }
    function award(address recipient, uint256 badgeId) external onlyRole(ATTESTOR_ROLE) {
        if (awarded[recipient][badgeId]) revert AlreadyAwarded();
        awarded[recipient][badgeId] = true;
        _mint(recipient, badgeId, 1, "");
    }
    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns(bool) {
        return super.supportsInterface(interfaceId);
    }
}
