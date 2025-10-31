import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import NotificationsPage from "../src/pages/NotificationsPage.jsx";
import { listNotifications, ackNotification } from "../src/api/notifications.js";

jest.mock("../src/api/notifications.js", () => ({
  listNotifications: jest.fn(),
  ackNotification: jest.fn(),
  clearResolved: jest.fn(),
}));

jest.mock("../src/context/AuthContext", () => {
  const actual = jest.requireActual("../src/context/AuthContext");
  return {
    ...actual,
    useAuth: jest.fn(),
  };
});

const { useAuth } = require("../src/context/AuthContext");

describe("NotificationsPage", () => {
  beforeEach(() => {
    listNotifications.mockResolvedValue({
      data: {
        items: [
          {
            id: 1,
            provider: "VMWARE",
            vm_name: "vm-test-01",
            metric: "CPU",
            value_pct: 90.0,
            threshold_pct: 85.0,
            status: "OPEN",
            correlation_id: "abc",
            created_at: "2024-01-01T12:00:00Z",
            at: "2024-01-01T12:00:00Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
    });
    ackNotification.mockResolvedValue({
      data: {
        id: 1,
        status: "ACK",
      },
    });
    useAuth.mockReturnValue({
      isSuperadmin: true,
      token: "fake-token",
      mustChangePassword: false,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders notifications and allows ACK", async () => {
    render(<NotificationsPage />);

    await waitFor(() => expect(listNotifications).toHaveBeenCalled());

    expect(await screen.findByText("vm-test-01")).toBeInTheDocument();

    const ackButton = screen.getByRole("button", { name: /marcar en revisi.n/i });
    fireEvent.click(ackButton);

    await waitFor(() => expect(ackNotification).toHaveBeenCalledWith(1));
  });
});
