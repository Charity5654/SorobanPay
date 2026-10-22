import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AddressBookModal } from "@/components/AddressBookModal";

jest.mock("@/hooks/useAddressResolver", () => ({
  useAddressResolver: () => ({
    resolve: jest.fn(),
    isResolving: false,
    error: null,
  }),
}));

function renderModal() {
  function Harness() {
    const [isOpen, setIsOpen] = useState(false);
    const [showOpener, setShowOpener] = useState(true);

    return (
      <>
        {showOpener && (
          <button type="button" onClick={() => setIsOpen(true)}>
            Open address book
          </button>
        )}
        <button type="button" onClick={() => setShowOpener(false)}>
          Remove opener
        </button>
        <AddressBookModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          entries={{}}
          entryList={[]}
          addEntry={jest.fn()}
          updateEntry={jest.fn()}
          deleteEntry={jest.fn()}
          importBook={jest.fn()}
          exportBook={jest.fn()}
        />
      </>
    );
  }

  return render(<Harness />);
}

describe("AddressBookModal focus restoration", () => {
  it("returns focus to the opener after closing", () => {
    renderModal();
    const opener = screen.getByRole("button", { name: "Open address book" });
    opener.focus();
    fireEvent.click(opener);

    const closeButton = screen.getByRole("button", { name: "Close address book" });
    expect(closeButton).toHaveFocus();
    fireEvent.click(closeButton);

    expect(opener).toHaveFocus();
  });

  it("does not focus a detached opener after the dialog closes", () => {
    renderModal();
    const opener = screen.getByRole("button", { name: "Open address book" });
    opener.focus();
    fireEvent.click(opener);
    const focusOpener = jest.spyOn(opener, "focus");

    const removeOpener = screen.getByRole("button", { name: "Remove opener" });
    fireEvent.click(removeOpener);
    fireEvent.click(screen.getByRole("button", { name: "Close address book" }));

    expect(focusOpener).not.toHaveBeenCalled();
    expect(opener).not.toBeInTheDocument();
  });
});