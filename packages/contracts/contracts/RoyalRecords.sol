// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @notice Only trusted server attestors can anchor validated results or award achievements.
contract RoyalRecords is ERC1155, AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    struct Record { bytes32 resultHash; bytes32 winner; uint64 timestamp; address attestor; }
    mapping(bytes32 => Record) public records;
    mapping(address => mapping(uint256 => bool)) public awarded;
    event MatchAttested(bytes32 indexed matchId, bytes32 resultHash, bytes32 winner, address indexed attestor);
    error AlreadyAttested();
    error AlreadyAwarded();
    error InvalidRecord();
    constructor(address admin, string memory metadataURI) ERC1155(metadataURI) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTOR_ROLE, admin);
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
