-- FR-REC-09: an approved payment is IMMUTABLE. Block any change to its financial fields
-- once audit_status = APPROVED (and locked). Reversal/void (Phase 9) change other columns
-- (audit_status/voided) and are still permitted; only amount/date/Txn ID are frozen.
CREATE OR REPLACE FUNCTION prevent_approved_payment_edit() RETURNS trigger AS $$
BEGIN
  IF OLD.audit_status = 'APPROVED' AND OLD.locked = true THEN
    IF NEW.received_amount IS DISTINCT FROM OLD.received_amount
       OR NEW.expected_amount IS DISTINCT FROM OLD.expected_amount
       OR NEW.payment_date   IS DISTINCT FROM OLD.payment_date
       OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
      RAISE EXCEPTION 'An approved payment is immutable and cannot be edited (FR-REC-09).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_immutable_after_approve ON "payment";
CREATE TRIGGER payment_immutable_after_approve
  BEFORE UPDATE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION prevent_approved_payment_edit();
