// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/**
 * @title AgentShieldRegistry
 * @notice Anti-Sybil on-chain contract safety & reputation registry gated by Binance Wallet Agent ID (.ai).
 *
 *         Why Agent ID (.ai)?
 *         Each Binance KYC user can claim only one non-transferable .ai Agent ID on BNB Smart Chain.
 *         This provides native 1-human-1-vote Sybil resistance for community security attestations
 *         without requiring token staking or centralized moderation.
 *
 *         Core capabilities (zero protocol fees, gas only, zero fund custody):
 *         1. claimSafeBadge(): Free soulbound Safe Agent Check-in Badge (1 per .ai wallet).
 *         2. submitAudit():    1 .ai address = 1 vote per BSC contract to flag risks/honeypots or attest safety.
 */
contract AgentShieldRegistry {
    /// @notice Official Binance Wallet / SPACE ID Agent ID (.ai) BEP-721 Registry on BSC Mainnet.
    /// @dev Kept as a constant so the deployed runtime bytecode explicitly embeds the registry address.
    IAgentID public constant AGENT_ID_REGISTRY =
        IAgentID(0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);

    /// @notice Maximum UTF-8 byte length for on-chain audit note to keep gas minimal.
    uint256 public constant MAX_NOTE_BYTES = 120;

    // -------------------------------------------------------------------------
    // 1. Free Soulbound Safe Agent Badge
    // -------------------------------------------------------------------------
    mapping(address => uint256) public badgeIdOf;
    mapping(address => uint64) public badgeClaimedAt;
    uint256 public totalBadges;

    // -------------------------------------------------------------------------
    // 2. Anti-Sybil Contract Safety & Risk Registry
    // -------------------------------------------------------------------------
    struct TargetStats {
        uint32 safeVotes;
        uint32 riskVotes;
        uint64 lastUpdatedAt;
    }

    // 0 = none, 1 = SAFE, 2 = RISK
    mapping(address => mapping(address => uint8)) public voterChoice;
    mapping(address => TargetStats) public targetStats;
    uint256 public totalAudits;
    uint256 public totalUniqueAuditors;
    mapping(address => bool) public hasAuditedBefore;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event SafeBadgeClaimed(address indexed agentWallet, uint256 indexed badgeId, uint64 timestamp);
    event TargetAudited(
        address indexed agentWallet,
        address indexed targetContract,
        bool isRisk,
        uint8 riskCode,
        string note
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------
    error NotAgentIdHolder();
    error AlreadyClaimedBadge();
    error InvalidTarget();
    error NoteTooLong();

    modifier onlyAgentId() {
        if (AGENT_ID_REGISTRY.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        _;
    }

    /// @notice Check whether an address currently holds a Binance Wallet .ai Agent ID.
    function hasAgentId(address wallet) external view returns (bool) {
        return AGENT_ID_REGISTRY.balanceOf(wallet) > 0;
    }

    /// @notice Claim a free, non-transferable Safe Agent Badge (1 per .ai Agent ID wallet).
    function claimSafeBadge() external onlyAgentId {
        if (badgeIdOf[msg.sender] != 0) revert AlreadyClaimedBadge();
        uint64 ts = uint64(block.timestamp);
        uint256 id = ++totalBadges;
        badgeIdOf[msg.sender] = id;
        badgeClaimedAt[msg.sender] = ts;
        emit SafeBadgeClaimed(msg.sender, id, ts);
    }

    /// @notice Submit or update a safety/risk attestation for a BSC target contract.
    /// @param target   The BSC contract address being reviewed.
    /// @param isRisk   true = flag as risk/honeypot/rug, false = attest as safe.
    /// @param riskCode 0=safe, 1=honeypot_or_high_tax, 2=unverified_or_rug, 3=fake_mint_or_trap, 4=other.
    /// @param note     Optional short evidence note (max 120 bytes).
    function submitAudit(
        address target,
        bool isRisk,
        uint8 riskCode,
        string calldata note
    ) external onlyAgentId {
        if (target == address(0) || target == address(this)) revert InvalidTarget();
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong();

        uint8 prev = voterChoice[target][msg.sender];
        uint8 next = isRisk ? 2 : 1;
        TargetStats storage st = targetStats[target];

        if (prev == 0) {
            totalAudits++;
        } else if (prev == 1) {
            st.safeVotes--;
        } else if (prev == 2) {
            st.riskVotes--;
        }

        if (next == 1) {
            st.safeVotes++;
        } else {
            st.riskVotes++;
        }

        if (!hasAuditedBefore[msg.sender]) {
            hasAuditedBefore[msg.sender] = true;
            totalUniqueAuditors++;
        }

        voterChoice[target][msg.sender] = next;
        st.lastUpdatedAt = uint64(block.timestamp);

        emit TargetAudited(msg.sender, target, isRisk, riskCode, note);
    }

    /// @notice Convenience read helper for frontends and AI Agent CLI tools.
    function getTargetSummary(address target)
        external
        view
        returns (uint32 safeVotes, uint32 riskVotes, uint64 lastUpdatedAt)
    {
        TargetStats memory st = targetStats[target];
        return (st.safeVotes, st.riskVotes, st.lastUpdatedAt);
    }
}
